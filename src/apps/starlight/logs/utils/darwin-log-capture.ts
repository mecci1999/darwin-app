import { LogLevel, LogSource, StoredLog } from '../types';
import { LogProcessor } from './log-processor';
import { elasticsearchManager } from './elasticsearch-manager';
import { broadcastToStreams } from '../actions/stream';
import * as fs from 'fs/promises';
import * as path from 'path';

const SYSTEM_TENANT_ID = 'system';
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 100;
const FORWARD_BATCH_SIZE = 20;
const FORWARD_FLUSH_MS = 200;
const MAX_FALLBACK_REPLAY_BYTES = 1024 * 1024;
const MAX_STORED_MESSAGE_CHARS = 64 * 1024;
const FALLBACK_DIR = path.resolve(process.cwd(), 'logs/darwin-capture-fallback');
const FALLBACK_FILE = path.join(FALLBACK_DIR, `${SYSTEM_TENANT_ID}.jsonl`);
const SKIP_FORWARD_MODULES = new Set(['transit', 'transporter', 'registry']);
const SKIP_GATEWAY_BROADCAST_MODULES = new Set(['transit', 'transporter', 'registry', 'star']);

type LoggerBindings = {
  nodeID?: string;
  namespace?: string;
  mod?: string;
  svc?: string;
  ver?: string;
  version?: string;
};

type CaptureState = {
  queue: StoredLog[];
  timer?: NodeJS.Timeout;
  flushing: boolean;
  enabled: boolean;
  replaying: boolean;
  broadcastingToGateway: boolean;
  gatewayBroadcast?: (log: StoredLog) => void;
};

export type DarwinLogRecord = {
  level?: string;
  args?: any[];
  bindings?: LoggerBindings;
};

const state: CaptureState = {
  queue: [],
  flushing: false,
  enabled: false,
  replaying: false,
  broadcastingToGateway: false,
  gatewayBroadcast: undefined,
};

const processor = new LogProcessor();

function formatLogArg(value: any): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeMessage(args: any[]): { message: string; metadata: Record<string, any> } {
  const message = args.map(formatLogArg).join(' ').trim();

  return {
    message,
    metadata: {},
  };
}

function toSafeValue(value: any): any {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value === undefined) return null;

  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function toLevel(level: string): LogLevel {
  if (Object.values(LogLevel).includes(level as LogLevel)) return level as LogLevel;
  return LogLevel.INFO;
}

function shouldCaptureLog(level: LogLevel): boolean {
  return Object.values(LogLevel).includes(level);
}

function shouldIgnoreForwardedGatewayLog(args: any[], bindings: LoggerBindings): boolean {
  const serviceName = bindings.svc || bindings.mod || '';
  if (serviceName !== 'gateway') return false;

  return args.some((arg) => {
    if (typeof arg === 'string') {
      return arg.includes('gateway.websocket.trigger') || arg.includes("Response 'gateway.websocket.trigger'");
    }

    return false;
  });
}

function getBindingModuleName(bindings: LoggerBindings): string {
  return String(bindings.mod || bindings.svc || '').toLowerCase();
}

function shouldIgnoreForwardToLogs(args: any[], bindings: LoggerBindings): boolean {
  const moduleName = getBindingModuleName(bindings);
  if (SKIP_FORWARD_MODULES.has(moduleName)) return true;

  return args.some((arg) => {
    if (typeof arg !== 'string') return false;
    return (
      arg.includes("Unable to send send to 'logs-development'") ||
      arg.includes('Kafka Server Publish error') ||
      arg.includes('Timeout while acquiring lock') ||
      arg.includes('Cleaning up excess request')
    );
  });
}

function shouldSkipGatewayBroadcast(log: StoredLog): boolean {
  const moduleName = String(log.mod || log.svc || log.service || '').toLowerCase();
  if (SKIP_GATEWAY_BROADCAST_MODULES.has(moduleName)) return true;
  if (moduleName === 'logs') return true;

  const message = String(log.message || '');
  return (
    message.includes('gateway.websocket.trigger') ||
    message.includes("Unable to send send to 'logs-development'") ||
    message.includes('Kafka Server Publish error') ||
    message.includes('Timeout while acquiring lock') ||
    message.includes('Cleaning up excess request')
  );
}

function shouldIgnoreDuringGatewayBroadcast(args: any[]): boolean {
  return args.some((arg) => {
    if (typeof arg !== 'string') return false;
    return (
      arg.includes('gateway.websocket.trigger') ||
      arg.includes("Response 'gateway.websocket.trigger'")
    );
  });
}

function buildStoredLog(level: string, args: any[], bindings: LoggerBindings): StoredLog | null {
  if (shouldIgnoreForwardedGatewayLog(args, bindings)) return null;
  if (state.broadcastingToGateway && shouldIgnoreDuringGatewayBroadcast(args)) return null;

  const normalized = normalizeMessage(args);
  if (!normalized.message.trim()) return null;

  const logLevel = toLevel(level);
  if (!shouldCaptureLog(logLevel)) return null;

  return processor.normalizeLog(
    {
      message: trimMessageForStorage(normalized.message),
      level: logLevel,
      timestamp: new Date().toISOString(),
      source: LogSource.SYSTEM,
      originType: 'darwin-app',
      visibility: 'admin',
      service: bindings.svc || bindings.mod || 'darwin-app',
      nodeID: bindings.nodeID,
      namespace: bindings.namespace,
      mod: bindings.mod,
      svc: bindings.svc,
      version: bindings.version || bindings.ver,
      metadata: {
        logger: bindings,
      },
      tags: ['darwin-app'],
    },
    SYSTEM_TENANT_ID,
  );
}

function trimMessageForStorage(message: string): string {
  if (message.length <= MAX_STORED_MESSAGE_CHARS) return message;
  return `${message.slice(0, MAX_STORED_MESSAGE_CHARS)}\n...[truncated ${message.length - MAX_STORED_MESSAGE_CHARS} chars to fit Elasticsearch bulk limits]`;
}

function sanitizeMetadata(metadata: StoredLog['metadata']): Record<string, unknown> {
  const logger = metadata?.logger;
  return logger && typeof logger === 'object' ? { logger } : {};
}

function sanitizeStoredLog(log: StoredLog): StoredLog {
  return {
    ...log,
    message: trimMessageForStorage(String(log.message || '')),
    metadata: sanitizeMetadata(log.metadata),
  };
}

function estimateBulkLogBytes(log: StoredLog): number {
  return Buffer.byteLength(JSON.stringify({ index: { _id: log.id } }), 'utf8') +
    Buffer.byteLength(JSON.stringify(log), 'utf8') +
    2;
}

function takeReplayBatch(entries: Array<{ log: StoredLog }>): Array<{ log: StoredLog }> {
  const batch: Array<{ log: StoredLog }> = [];
  let batchBytes = 0;

  for (const entry of entries) {
    if (batch.length >= MAX_BATCH_SIZE) break;

    const log = sanitizeStoredLog(entry.log);
    const logBytes = estimateBulkLogBytes(log);
    if (batch.length > 0 && batchBytes + logBytes > MAX_FALLBACK_REPLAY_BYTES) break;

    batch.push({ log });
    batchBytes += logBytes;
  }

  return batch;
}

async function ensureFallbackDir() {
  await fs.mkdir(FALLBACK_DIR, { recursive: true });
}

async function appendFallbackLogs(logs: StoredLog[], reason: string, errorItems?: Array<Record<string, any>>) {
  if (logs.length === 0) return;
  await ensureFallbackDir();

  const firstError = errorItems?.[0];
  const lines = logs
    .map((log) =>
      JSON.stringify({
        log: sanitizeStoredLog(log),
        reason,
        error: firstError
          ? {
              status: firstError.status,
              errorType: firstError.errorType,
              reason: firstError.reason,
            }
          : undefined,
        storedAt: new Date().toISOString(),
      }),
    )
    .join('\n');

  await fs.appendFile(FALLBACK_FILE, `${lines}\n`, 'utf8');
}

async function readFallbackEntries(): Promise<Array<{ log: StoredLog }>> {
  try {
    const content = await fs.readFile(FALLBACK_FILE, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry?.log)
      .map((entry) => ({ log: sanitizeStoredLog(entry.log) }));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeFallbackEntries(entries: Array<{ log: StoredLog }>) {
  await ensureFallbackDir();
  if (entries.length === 0) {
    await fs.writeFile(FALLBACK_FILE, '', 'utf8');
    return;
  }

  const lines = entries.map((entry) => JSON.stringify({ log: sanitizeStoredLog(entry.log) })).join('\n');
  await fs.writeFile(FALLBACK_FILE, `${lines}\n`, 'utf8');
}

async function replayFallbackLogs() {
  if (state.replaying) return;
  state.replaying = true;

  try {
    const entries = await readFallbackEntries();
    if (entries.length === 0) return;

    const replayEntries = takeReplayBatch(entries);
    if (replayEntries.length === 0) return;

    const replayBatch = replayEntries.map((entry) => entry.log);
    const esClient = elasticsearchManager.getClient(SYSTEM_TENANT_ID);
    const result = await esClient.bulkIndex(replayBatch);

    const remainingEntries = [
      ...result.failedLogs.map((log) => ({ log: sanitizeStoredLog(log) })),
      ...entries.slice(replayEntries.length),
    ];
    await writeFallbackEntries(remainingEntries);

    if (result.failedLogs.length > 0) {
      console.error('Darwin fallback replay partial failure:', result.errorItems);
    }
  } catch (error) {
    console.error('Failed to replay Darwin fallback logs', error);
  } finally {
    state.replaying = false;
  }
}

export function enqueueDarwinLogRecord(record: unknown): boolean {
  if (!state.enabled || !record || typeof record !== 'object') return false;

  const nextRecord = record as DarwinLogRecord;
  const log = buildStoredLog(
    typeof nextRecord.level === 'string' ? nextRecord.level : 'info',
    Array.isArray(nextRecord.args) ? nextRecord.args : [],
    nextRecord.bindings && typeof nextRecord.bindings === 'object' ? nextRecord.bindings : {},
  );
  if (!log) return false;

  state.queue.push(log);
  broadcastToStreams(log, SYSTEM_TENANT_ID);
  if (!shouldSkipGatewayBroadcast(log)) {
    state.gatewayBroadcast?.(log);
  }
  if (!state.flushing && state.queue.length >= MAX_BATCH_SIZE) {
    void flushQueue();
  }
  return true;
}

export function enqueueDarwinLogRecords(records: unknown[]): number {
  let accepted = 0;
  for (const record of records) {
    if (enqueueDarwinLogRecord(record)) {
      accepted += 1;
    }
  }
  return accepted;
}

async function flushQueue() {
  if (state.flushing || state.queue.length === 0) return;
  state.flushing = true;

  const batch = state.queue.splice(0, MAX_BATCH_SIZE);
  try {
    const esClient = elasticsearchManager.getClient(SYSTEM_TENANT_ID);
    const result = await esClient.bulkIndex(batch);

    if (result.failedLogs.length > 0) {
      await appendFallbackLogs(result.failedLogs, 'partial_bulk_failure', result.errorItems);
    }
  } catch (error) {
    await appendFallbackLogs(batch, 'bulk_failure');
    console.error('Failed to flush Darwin logs', error);
  } finally {
    state.flushing = false;
  }
}

export async function flushDarwinLogCaptureNow() {
  await flushQueue();
}

export function createDarwinLogCaptureMiddleware() {
  return {
    newLogEntry(...entry: unknown[]) {
      const [type, args, bindings] = entry;
      enqueueDarwinLogRecord({ level: type, args, bindings });
    },
  };
}

function hasAvailableAction(star: { registry?: { actions?: { list?: (options?: any) => Array<{ name: string; available?: boolean }> } } }, serviceName: string) {
  const actions = star.registry?.actions?.list?.({ onlyAvaliable: true });
  return Array.isArray(actions) && actions.some((action) => action.name === serviceName && action.available !== false);
}

export function createDarwinLogForwardMiddleware(serviceName: string = 'logs.v1.capture-darwin') {
  let forwarding: Promise<void> = Promise.resolve();
  let pendingRecords: DarwinLogRecord[] = [];
  let flushTimer: NodeJS.Timeout | undefined;

  const flushPending = (star: {
    call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }) => Promise<unknown>;
    registry?: { actions?: { list?: (options?: any) => Array<{ name: string; available?: boolean }> } };
  }) => {
    if (typeof star.call !== 'function') return;
    if (!hasAvailableAction(star, serviceName)) return;
    if (pendingRecords.length === 0) return;

    const records = pendingRecords.splice(0, FORWARD_BATCH_SIZE);
    forwarding = forwarding
      .catch(() => undefined)
      .then(() => star.call!(serviceName, { records }).then(() => undefined))
      .catch(() => undefined)
      .finally(() => {
        if (pendingRecords.length > 0 && !flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flushPending(star);
          }, FORWARD_FLUSH_MS);
        }
      });
  };

  return function darwinLogForwardMiddleware(star: {
    call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }) => Promise<unknown>;
    registry?: { actions?: { list?: (options?: any) => Array<{ name: string; available?: boolean }> } };
  }) {
    return {
      newLogEntry(...entry: unknown[]) {
        if (typeof star.call !== 'function') return;
        if (!hasAvailableAction(star, serviceName)) return;

        const [type, args, bindings] = entry;
        const nextBindings = bindings && typeof bindings === 'object' ? bindings as LoggerBindings : {};
        const nextArgs = Array.isArray(args) ? args : [];
        if (shouldIgnoreForwardToLogs(nextArgs, nextBindings)) return;

        pendingRecords.push({
          level: typeof type === 'string' ? type : 'info',
          args: nextArgs,
          bindings: nextBindings,
        });

        if (pendingRecords.length >= FORWARD_BATCH_SIZE) {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
          }
          flushPending(star);
          return;
        }

        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flushPending(star);
          }, FORWARD_FLUSH_MS);
        }
      },
    };
  };
}

export function registerDarwinLogForwarding(star: {
  call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }) => Promise<unknown>;
  middlewares?: { add?: (middleware: unknown) => void } | null;
}) {
  star.middlewares?.add?.(createDarwinLogForwardMiddleware()(star));
}

export async function publishDarwinLogToGateway(
  star: { call?: (name: string, params: Record<string, unknown>) => Promise<unknown> },
  log: StoredLog,
) {
  if (typeof star.call !== 'function') return;
  if (state.broadcastingToGateway) return;

  state.broadcastingToGateway = true;
  try {
    await star.call('gateway.websocket.trigger', {
      eventName: 'logs',
      data: {
        id: log.id,
        level: log.level,
        message: log.message,
        timestamp: log.timestamp,
        service: log.service,
        originType: log.originType,
        tenantId: log.tenantId,
        nodeID: log.nodeID,
        namespace: log.namespace,
        mod: log.mod,
        svc: log.svc,
      },
    });
  } catch {
    // best effort only
  } finally {
    state.broadcastingToGateway = false;
  }
}

export function startDarwinLogCapture(options?: { onBroadcast?: (log: StoredLog) => void }) {
  state.enabled = true;
  state.gatewayBroadcast = options?.onBroadcast;
  if (!state.timer) {
    state.timer = setInterval(() => {
      void replayFallbackLogs();
      void flushQueue();
    }, FLUSH_INTERVAL_MS);
  }
}

export async function stopDarwinLogCapture() {
  state.enabled = false;
  state.gatewayBroadcast = undefined;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  await replayFallbackLogs();
  await flushQueue();
}

import { LogLevel, LogSearchParams, LogSource, LogStatsParams, StoredLog } from '../types';
import { LogProcessor } from './log-processor';
import { elasticsearchManager } from './elasticsearch-manager';
import { isElasticsearchReadOnlyBlockError } from './elasticsearch';
import { broadcastToStreams } from '../actions/stream';
import { sanitizeLogMessageText } from './log-message-sanitize';
import { getDebugDiagnosticsState } from './debug-diagnostics';
import * as fs from 'fs/promises';
import * as path from 'path';

const SYSTEM_TENANT_ID = 'system';
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 100;
const MAX_CAPTURE_QUEUE_RECORDS = 2_000;
const FORWARD_BATCH_SIZE = 20;
const FORWARD_FLUSH_MS = 200;
const FORWARD_UNAVAILABLE_FALLBACK_MS = 5000;
const FORWARD_FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_FORWARD_PENDING_RECORDS = 200;
const MAX_FALLBACK_REPLAY_BYTES = 1024 * 1024;
const MAX_STORED_MESSAGE_CHARS = 64 * 1024;
const READ_ONLY_REPLAY_BACKOFF_MS = 60 * 1000;
const FORWARD_FAILURE_WARNING_INTERVAL_MS = 30 * 1000;
const FORWARD_DIAGNOSTIC_INTERVAL_MS = 10 * 1000;
const FALLBACK_DIR = path.resolve(process.cwd(), 'logs/darwin-capture-fallback');
const FALLBACK_FILE = path.join(FALLBACK_DIR, `${SYSTEM_TENANT_ID}.jsonl`);
const SKIP_FORWARD_MODULES = new Set(['transit', 'transporter', 'registry']);
const SKIP_GATEWAY_BROADCAST_MODULES = new Set(['transit', 'transporter', 'registry', 'star']);
const DARWIN_FRAMEWORK_MODULES = new Set(['star', 'transit', 'transporter', 'registry', 'cacher']);

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
  flushPromise?: Promise<void>;
  enabled: boolean;
  replaying: boolean;
  broadcastingToGateway: boolean;
  gatewayBroadcast?: (log: StoredLog) => void;
  nextReplayAt: number;
  lastReplayBlockWarningAt: number;
};

export type DarwinLogRecord = {
  level?: string;
  args?: any[];
  bindings?: LoggerBindings;
};

const state: CaptureState = {
  queue: [],
  flushing: false,
  flushPromise: undefined,
  enabled: false,
  replaying: false,
  broadcastingToGateway: false,
  gatewayBroadcast: undefined,
  nextReplayAt: 0,
  lastReplayBlockWarningAt: 0,
};

const processor = new LogProcessor();
let lastForwardFailureWarningAt = 0;
let lastCaptureQueueWarningAt = 0;

const forwardDiagnosticState = new Map<string, number>();

function isForwardDiagnosticsEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.DARWIN_LOG_FORWARD_DIAGNOSTICS || '').trim().toLowerCase());
}

function isDarwinDebugCaptureEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.DARWIN_CAPTURE_DEBUG_LOGS || '').trim().toLowerCase());
}

function isGatewayForwardRecord(record: DarwinLogRecord | undefined) {
  const bindings = record?.bindings || {};
  return String(bindings.svc || bindings.mod || '').toLowerCase() === 'gateway';
}

function isGatewayExplorerRecord(record: DarwinLogRecord | undefined) {
  if (!isGatewayForwardRecord(record)) return false;
  const args = Array.isArray(record?.args) ? record.args : [];
  return args.some((arg) => typeof arg === 'string' && arg.includes('/api/logs/v1/explorer/'));
}

function logGatewayForwardDiagnostic(key: string, message: string, details: Record<string, unknown>) {
  if (!isForwardDiagnosticsEnabled()) return;

  const now = Date.now();
  const lastLoggedAt = forwardDiagnosticState.get(key) || 0;
  if (now - lastLoggedAt < FORWARD_DIAGNOSTIC_INTERVAL_MS) return;
  forwardDiagnosticState.set(key, now);
  console.info(message, details);
}

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
  const message = sanitizeLogMessageText(args.map(formatLogArg).join(' '));

  return {
    message,
    metadata: {},
  };
}

function toLevel(level: string): LogLevel {
  if (Object.values(LogLevel).includes(level as LogLevel)) return level as LogLevel;
  return LogLevel.INFO;
}

function shouldCaptureLog(level: LogLevel): boolean {
  if (level === LogLevel.DEBUG && !isDarwinDebugCaptureEnabled() && !getDebugDiagnosticsState().enabled) return false;
  return Object.values(LogLevel).includes(level);
}

function isHighPriorityLog(level: LogLevel): boolean {
  return level === LogLevel.WARN || level === LogLevel.ERROR || level === LogLevel.FATAL;
}

function warnCaptureQueueOverflow() {
  const now = Date.now();
  if (now - lastCaptureQueueWarningAt < FORWARD_FAILURE_WARNING_INTERVAL_MS) return;
  lastCaptureQueueWarningAt = now;
  console.warn(`Darwin log capture queue reached ${MAX_CAPTURE_QUEUE_RECORDS}; low-priority records are being dropped`);
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

function isFrameworkDebugNoise(args: any[], bindings: LoggerBindings): boolean {
  const moduleName = getBindingModuleName(bindings);
  if (!DARWIN_FRAMEWORK_MODULES.has(moduleName)) return false;

  return args.some((arg) => {
    if (typeof arg !== 'string') return false;
    return (
      /^Emit 'metrics\.raw' event/.test(arg) ||
      /^Emit '\$metrics\.snapshot' event/.test(arg) ||
      /^<= Request 'logs\.v1\.capture-darwin' .*received from '.*' node\.$/.test(arg)
    );
  });
}

function getBindingModuleName(bindings: LoggerBindings): string {
  return String(bindings.mod || bindings.svc || '').toLowerCase();
}

function getServiceNameFromNodeID(nodeID?: string): string | undefined {
  const normalizedNodeID = String(nodeID || '').trim();
  if (!normalizedNodeID) return undefined;

  const environmentSuffix = `-${process.env.NODE_ENV || 'development'}`;
  if (normalizedNodeID.endsWith(environmentSuffix)) {
    return normalizedNodeID.slice(0, -environmentSuffix.length);
  }

  return normalizedNodeID;
}

function resolveDarwinServiceName(bindings: LoggerBindings): string {
  const svc = String(bindings.svc || '').trim();
  if (svc) return svc;

  const moduleName = getBindingModuleName(bindings);
  if (moduleName && !DARWIN_FRAMEWORK_MODULES.has(moduleName)) return moduleName;

  return getServiceNameFromNodeID(bindings.nodeID) || moduleName || 'darwin-app';
}

function shouldIgnoreForwardToLogs(args: any[], bindings: LoggerBindings): boolean {
  const moduleName = getBindingModuleName(bindings);
  if (SKIP_FORWARD_MODULES.has(moduleName)) return true;

  return args.some((arg) => {
    if (typeof arg !== 'string') return false;
    return (
      arg.includes("Unable to send send to 'logs-development'") ||
      arg.includes("Request 'logs.v1.capture-darwin' is timed out") ||
      arg.includes("Request is timed out when call 'logs.v1.capture-darwin'") ||
      arg.includes('Darwin log forwarding fell back to local capture file') ||
      arg.includes('Kafka Server Publish error') ||
      arg.includes('Timeout while acquiring lock') ||
      arg.includes('Cleaning up excess request') ||
      arg.includes("Emit '$metrics.snapshot' event") ||
      arg.includes("Emit 'metrics.raw' event")
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
  if (isFrameworkDebugNoise(args, bindings)) return null;
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
      service: resolveDarwinServiceName(bindings),
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

function recordsToStoredLogs(records: DarwinLogRecord[]): StoredLog[] {
  return records
    .map((record) => buildStoredLog(
      typeof record.level === 'string' ? record.level : 'info',
      Array.isArray(record.args) ? record.args : [],
      record.bindings && typeof record.bindings === 'object' ? record.bindings : {},
    ))
    .filter((log): log is StoredLog => Boolean(log));
}

function summarizeForwardError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function warnForwardFailure(message: string, details: Record<string, unknown>) {
  const now = Date.now();
  if (now - lastForwardFailureWarningAt < FORWARD_FAILURE_WARNING_INTERVAL_MS) return;
  lastForwardFailureWarningAt = now;
  console.warn(message, details);
}

function logForwardDiagnostic(key: string, message: string, details: Record<string, unknown>) {
  if (!isForwardDiagnosticsEnabled()) return;

  const now = Date.now();
  const lastLoggedAt = forwardDiagnosticState.get(key) || 0;
  if (now - lastLoggedAt < FORWARD_DIAGNOSTIC_INTERVAL_MS) return;
  forwardDiagnosticState.set(key, now);
  console.info(message, details);
}

function readForwardAcceptedCount(result: unknown, fallback: number) {
  const payload = result as any;
  const candidates = [
    payload?.data?.content?.accepted,
    payload?.content?.accepted,
    payload?.accepted,
    payload?.data?.data?.content?.accepted,
  ];
  const accepted = candidates.map(Number).find((value) => Number.isFinite(value));
  return accepted ?? fallback;
}

function summarizeForwardRecord(record: DarwinLogRecord | undefined) {
  if (!record) return null;
  const bindings = record.bindings || {};
  const firstArg = Array.isArray(record.args) ? record.args[0] : undefined;
  return {
    level: record.level,
    nodeID: bindings.nodeID,
    namespace: bindings.namespace,
    mod: bindings.mod,
    svc: bindings.svc,
    message: typeof firstArg === 'string' ? firstArg.slice(0, 120) : firstArg === undefined ? undefined : String(firstArg).slice(0, 120),
  };
}

async function persistForwardedRecordsToFallback(records: DarwinLogRecord[], reason: string, error?: unknown) {
  const logs = recordsToStoredLogs(records);
  if (logs.length === 0) return;
  await appendFallbackLogs(logs, reason);
  warnForwardFailure('Darwin log forwarding fell back to local capture file', {
    reason,
    records: records.length,
    storedLogs: logs.length,
    fallbackFile: FALLBACK_FILE,
    error: error ? summarizeForwardError(error) : undefined,
  });
}

function summarizeFallbackBulkFailure(failedCount: number, errorItems: Array<Record<string, any>>) {
  const byErrorType = errorItems.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.errorType || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const firstError = errorItems[0];

  return {
    failedCount,
    status: firstError?.status,
    firstErrorType: firstError?.errorType,
    firstReason: firstError?.reason,
    byErrorType,
  };
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

function toTimestamp(value: string | number | Date | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const dateValue = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const timestamp = new Date(dateValue as string | number | Date).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

type FallbackQueryParams = {
  tenantId?: string;
  service?: string;
  level?: LogSearchParams['level'];
  source?: LogSearchParams['source'];
  originType?: LogSearchParams['originType'];
  visibility?: LogSearchParams['visibility'];
  hostname?: string;
  excludeNodeIDs?: string[];
  excludeServices?: string[];
  levels?: LogSearchParams['levels'];
  filters?: Record<string, unknown>;
  query?: string;
  startTime?: string | number;
  endTime?: string | number;
};

function readLogField(log: StoredLog, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(log, field) ? log[field as keyof StoredLog] : undefined;
}

function fallbackLogMatches(log: StoredLog, params: FallbackQueryParams): boolean {
  if (params.tenantId && log.tenantId !== params.tenantId) return false;
  if (params.service && log.service !== params.service) return false;
  if (params.excludeServices?.includes(String(log.service || ''))) return false;
  if (params.level) {
    const levels = Array.isArray(params.level) ? params.level : [params.level];
    if (!levels.includes(log.level)) return false;
  }
  if (params.levels?.length) {
    if (!params.levels.includes(log.level)) return false;
  }
  if (params.source) {
    const sources = Array.isArray(params.source) ? params.source : [params.source];
    const logSource = log.source;
    if (!logSource) return false;
    if (!sources.includes(logSource)) return false;
  }
  if (params.originType && log.originType !== params.originType) return false;
  if (params.visibility && log.visibility !== params.visibility) return false;
  if (params.hostname && log.hostname !== params.hostname) return false;
  if (params.excludeNodeIDs?.includes(String(log.nodeID || ''))) return false;

  if (params.filters) {
    for (const [field, value] of Object.entries(params.filters)) {
      if (readLogField(log, field) !== value) return false;
    }
  }

  const query = String(params.query || '').trim().toLowerCase();
  if (query && query !== '*') {
    const searchable = [log.message, log.service, log.source, log.hostname, log.nodeID, log.namespace, log.mod, log.svc]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!searchable.includes(query)) return false;
  }

  const logTime = toTimestamp(log.timestamp);
  if (!logTime) return false;

  const startTime = toTimestamp(params.startTime);
  if (startTime && logTime < startTime) return false;

  const endTime = toTimestamp(params.endTime);
  if (endTime && logTime > endTime) return false;

  return true;
}

function sortFallbackLogs(logs: StoredLog[], sortBy = 'timestamp', sortOrder: 'asc' | 'desc' = 'desc') {
  return logs.sort((left, right) => {
    const leftValue = readLogField(left, sortBy);
    const rightValue = readLogField(right, sortBy);
    const leftComparable = sortBy === 'timestamp' ? toTimestamp(left.timestamp) || 0 : String(leftValue || '');
    const rightComparable = sortBy === 'timestamp' ? toTimestamp(right.timestamp) || 0 : String(rightValue || '');

    if (leftComparable < rightComparable) return sortOrder === 'asc' ? -1 : 1;
    if (leftComparable > rightComparable) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
}

export async function searchDarwinFallbackLogs(params: LogSearchParams): Promise<{ logs: StoredLog[]; total: number }> {
  const entries = await readFallbackEntries();
  const matchedLogs = entries
    .map((entry) => entry.log)
    .filter((log) => fallbackLogMatches(log, params));

  sortFallbackLogs(matchedLogs, params.sortBy || 'timestamp', params.sortOrder || 'desc');

  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, params.pageSize || params.limit || 50);
  const offset = (page - 1) * limit;

  return {
    logs: matchedLogs.slice(offset, offset + limit),
    total: matchedLogs.length,
  };
}

export async function getDarwinFallbackStats(params: LogStatsParams): Promise<{
  total: number;
  breakdown: Record<string, number>;
  levelBreakdown: Record<string, number>;
  serviceBreakdown: Record<string, number>;
}> {
  const entries = await readFallbackEntries();
  const logs = entries
    .map((entry) => entry.log)
    .filter((log) => fallbackLogMatches(log, params));

  const breakdown: Record<string, number> = {};
  const levelBreakdown: Record<string, number> = {};
  const serviceBreakdown: Record<string, number> = {};
  const groupBy = params.groupBy || 'level';

  logs.forEach((log) => {
    const groupKey = groupBy === 'hour'
      ? new Date(log.timestamp).toISOString().slice(0, 13)
      : groupBy === 'day'
        ? new Date(log.timestamp).toISOString().slice(0, 10)
        : String(readLogField(log, groupBy) || 'unknown');

    breakdown[groupKey] = (breakdown[groupKey] || 0) + 1;
    levelBreakdown[log.level] = (levelBreakdown[log.level] || 0) + 1;
    serviceBreakdown[log.service || 'unknown'] = (serviceBreakdown[log.service || 'unknown'] || 0) + 1;
  });

  return {
    total: logs.length,
    breakdown,
    levelBreakdown,
    serviceBreakdown,
  };
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
  if (Date.now() < state.nextReplayAt) return;
  if (!elasticsearchManager.isConnected() && !(await elasticsearchManager.ensureConnected())) return;
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
      const summary = summarizeFallbackBulkFailure(result.failedLogs.length, result.errorItems);
      const readOnlyBlocked = result.errorItems.some(isElasticsearchReadOnlyBlockError);
      if (readOnlyBlocked) {
        state.nextReplayAt = Date.now() + READ_ONLY_REPLAY_BACKOFF_MS;
        if (Date.now() - state.lastReplayBlockWarningAt >= READ_ONLY_REPLAY_BACKOFF_MS) {
          console.warn('Darwin fallback replay paused while Elasticsearch index is read-only:', summary);
          state.lastReplayBlockWarningAt = Date.now();
        }
      } else {
        console.error('Darwin fallback replay partial failure:', summary);
      }
    }
  } catch (error) {
    console.error('Failed to replay Darwin fallback logs', error);
  } finally {
    state.replaying = false;
  }
}

function enqueueDarwinLogRecordInternal(record: unknown, options: { requireEnabled: boolean }): boolean {
  if (options.requireEnabled && !state.enabled) return false;
  if (!record || typeof record !== 'object') return false;

  const nextRecord = record as DarwinLogRecord;
  const log = buildStoredLog(
    typeof nextRecord.level === 'string' ? nextRecord.level : 'info',
    Array.isArray(nextRecord.args) ? nextRecord.args : [],
    nextRecord.bindings && typeof nextRecord.bindings === 'object' ? nextRecord.bindings : {},
  );
  if (!log) return false;

  if (state.queue.length >= MAX_CAPTURE_QUEUE_RECORDS) {
    if (!isHighPriorityLog(log.level)) {
      warnCaptureQueueOverflow();
      return false;
    }

    const lowPriorityIndex = state.queue.findIndex((queued) => !isHighPriorityLog(queued.level));
    if (lowPriorityIndex >= 0) state.queue.splice(lowPriorityIndex, 1);
    else state.queue.shift();
    warnCaptureQueueOverflow();
  }

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

export function enqueueDarwinLogRecord(record: unknown): boolean {
  return enqueueDarwinLogRecordInternal(record, { requireEnabled: true });
}

export function enqueueForwardedDarwinLogRecord(record: unknown): boolean {
  return enqueueDarwinLogRecordInternal(record, { requireEnabled: false });
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

export function enqueueForwardedDarwinLogRecords(records: unknown[]): number {
  let accepted = 0;
  for (const record of records) {
    if (enqueueForwardedDarwinLogRecord(record)) {
      accepted += 1;
    }
  }
  return accepted;
}

async function flushQueueOnce(options?: { refresh?: boolean | 'wait_for' }) {
  if (state.queue.length === 0) return;
  state.flushing = true;

  const batch = state.queue.splice(0, MAX_BATCH_SIZE);
  try {
    if (!elasticsearchManager.isConnected() && !(await elasticsearchManager.ensureConnected())) {
      await appendFallbackLogs(batch, 'elasticsearch_unavailable');
      return;
    }
    const esClient = elasticsearchManager.getClient(SYSTEM_TENANT_ID);
    const result = await esClient.bulkIndex(batch, { refresh: options?.refresh });

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

async function flushQueue(options?: { refresh?: boolean | 'wait_for'; drain?: boolean }) {
  if (state.flushPromise) {
    await state.flushPromise;
  }

  if (state.queue.length === 0) return;

  state.flushPromise = (async () => {
    do {
      await flushQueueOnce({ refresh: options?.refresh });
    } while (options?.drain && state.queue.length > 0);
  })();

  try {
    await state.flushPromise;
  } finally {
    state.flushPromise = undefined;
  }
}

export async function flushDarwinLogCaptureNow() {
  await flushQueue();
}

export async function flushDarwinLogCaptureForSearch() {
  await flushQueue({ drain: true });
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
  let forwardingInFlight = false;
  let pendingRecords: DarwinLogRecord[] = [];
  let flushTimer: NodeJS.Timeout | undefined;
  let unavailableSince = 0;
  let circuitOpenUntil = 0;

  const flushPending = (star: {
    call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }, options?: { timeout?: number }) => Promise<unknown>;
    registry?: { actions?: { list?: (options?: any) => Array<{ name: string; available?: boolean }> } };
    started?: boolean;
  }) => {
    if (typeof star.call !== 'function') return;
    if (pendingRecords.length === 0) return;

    const now = Date.now();
    if (now < circuitOpenUntil) {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flushPending(star);
        }, circuitOpenUntil - now);
      }
      return;
    }

    if (star.started === false) {
      logForwardDiagnostic('darwin-forward-star-not-started', 'Darwin log forwarding waiting for Star startup', {
        serviceName,
        pendingRecords: pendingRecords.length,
        sample: summarizeForwardRecord(pendingRecords[0]),
      });
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flushPending(star);
        }, FORWARD_FLUSH_MS);
      }
      return;
    }

    if (!hasAvailableAction(star, serviceName)) {
      if (!unavailableSince) unavailableSince = Date.now();
      logForwardDiagnostic('darwin-forward-action-unavailable', 'Darwin log forwarding waiting for capture action', {
        serviceName,
        pendingRecords: pendingRecords.length,
        sample: summarizeForwardRecord(pendingRecords[0]),
      });
      if (Date.now() - unavailableSince >= FORWARD_UNAVAILABLE_FALLBACK_MS) {
        const records = pendingRecords.splice(0, pendingRecords.length);
        unavailableSince = 0;
        forwarding = forwarding
          .catch(() => undefined)
          .then(() => persistForwardedRecordsToFallback(records, 'capture_action_unavailable'));
        return;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flushPending(star);
        }, FORWARD_FLUSH_MS);
      }
      return;
    }
    unavailableSince = 0;
    if (forwardingInFlight) return;

    const records = pendingRecords.splice(0, FORWARD_BATCH_SIZE);
    forwardingInFlight = true;
    if (records.some(isGatewayExplorerRecord)) {
      logGatewayForwardDiagnostic('darwin-forward-gateway-flush', 'Darwin gateway log forwarding flushing records', {
        serviceName,
        records: records.length,
        gatewayExplorerRecords: records.filter(isGatewayExplorerRecord).length,
        remaining: pendingRecords.length,
        sample: summarizeForwardRecord(records.find(isGatewayExplorerRecord)),
      });
    }
    logForwardDiagnostic('darwin-forward-flush', 'Darwin log forwarding flushing records', {
      serviceName,
      records: records.length,
      remaining: pendingRecords.length,
      sample: summarizeForwardRecord(records[0]),
    });
    forwarding = forwarding
      .catch(() => undefined)
      .then(async () => {
        const result = await star.call!(serviceName, { records }, { timeout: 3000 });
        circuitOpenUntil = 0;
        const accepted = readForwardAcceptedCount(result, records.length);
        if (records.some(isGatewayExplorerRecord)) {
          logGatewayForwardDiagnostic('darwin-forward-gateway-result', 'Darwin gateway log forwarding capture result', {
            serviceName,
            records: records.length,
            gatewayExplorerRecords: records.filter(isGatewayExplorerRecord).length,
            accepted,
            sample: summarizeForwardRecord(records.find(isGatewayExplorerRecord)),
          });
        }
        logForwardDiagnostic('darwin-forward-result', 'Darwin log forwarding capture result', {
          serviceName,
          records: records.length,
          accepted,
          sample: summarizeForwardRecord(records[0]),
        });
        if (accepted <= 0) {
          await persistForwardedRecordsToFallback(records, 'capture_action_accepted_zero');
        }
      })
      .catch(async (error) => {
        // A busy logs service must not trigger a retry storm from every service.
        circuitOpenUntil = Math.max(circuitOpenUntil, Date.now() + FORWARD_FAILURE_BACKOFF_MS);
        await persistForwardedRecordsToFallback(records, 'forward_call_failure', error);
      })
      .finally(() => {
        forwardingInFlight = false;
        if (pendingRecords.length > 0 && !flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flushPending(star);
          }, Math.max(FORWARD_FLUSH_MS, circuitOpenUntil - Date.now()));
        }
      });
  };

  return function darwinLogForwardMiddleware(star: {
    call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }, options?: { timeout?: number }) => Promise<unknown>;
    registry?: { actions?: { list?: (options?: any) => Array<{ name: string; available?: boolean }> } };
    started?: boolean;
  }) {
    return {
      newLogEntry(...entry: unknown[]) {
        if (typeof star.call !== 'function') return;

        const [type, args, bindings] = entry;
        const nextBindings = bindings && typeof bindings === 'object' ? bindings as LoggerBindings : {};
        const nextArgs = Array.isArray(args) ? args : [];
        if (shouldIgnoreForwardToLogs(nextArgs, nextBindings)) return;

        const nextRecord = {
          level: typeof type === 'string' ? type : 'info',
          args: nextArgs,
          bindings: nextBindings,
        };

        if (pendingRecords.length >= MAX_FORWARD_PENDING_RECORDS) {
          forwarding = forwarding
            .catch(() => undefined)
            .then(() => persistForwardedRecordsToFallback([nextRecord], 'forward_queue_full'));
          return;
        }

        pendingRecords.push(nextRecord);

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
  call?: (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }, options?: { timeout?: number }) => Promise<unknown>;
  middlewares?: { add?: (middleware: unknown) => void } | null;
  started?: boolean;
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

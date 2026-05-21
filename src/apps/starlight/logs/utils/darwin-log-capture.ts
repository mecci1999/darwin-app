import { LogLevel, LogSource, StoredLog } from '../types';
import { LogProcessor } from './log-processor';
import { elasticsearchManager } from './elasticsearch-manager';
import { broadcastToStreams } from '../actions/stream';

const SYSTEM_TENANT_ID = 'system';
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH_SIZE = 100;

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
};

const processor = new LogProcessor();

function normalizeMessage(args: any[]): { message: string; metadata: Record<string, any> } {
  const [first, ...rest] = args;

  if (typeof first === 'string') {
    return {
      message: first,
      metadata: rest.length ? { args: rest.map(toSafeValue) } : {},
    };
  }

  if (first instanceof Error) {
    return {
      message: first.message,
      metadata: {
        error: {
          name: first.name,
          message: first.message,
          stack: first.stack,
        },
        args: rest.map(toSafeValue),
      },
    };
  }

  if (first && typeof first === 'object') {
    return {
      message: first.message || first.msg || JSON.stringify(first),
      metadata: {
        ...toSafeValue(first),
        args: rest.map(toSafeValue),
      },
    };
  }

  return {
    message: String(first ?? ''),
    metadata: rest.length ? { args: rest.map(toSafeValue) } : {},
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

function buildStoredLog(level: string, args: any[], bindings: LoggerBindings): StoredLog | null {
  const normalized = normalizeMessage(args);
  if (!normalized.message.trim()) return null;

  return processor.normalizeLog(
    {
      message: normalized.message,
      level: toLevel(level),
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
        ...normalized.metadata,
        logger: bindings,
      },
      tags: ['darwin-app'],
    },
    SYSTEM_TENANT_ID,
  );
}

export function enqueueDarwinLogRecord(record: unknown): boolean {
  if (!state.enabled || state.flushing || !record || typeof record !== 'object') return false;

  const nextRecord = record as DarwinLogRecord;
  const log = buildStoredLog(
    typeof nextRecord.level === 'string' ? nextRecord.level : 'info',
    Array.isArray(nextRecord.args) ? nextRecord.args : [],
    nextRecord.bindings && typeof nextRecord.bindings === 'object' ? nextRecord.bindings : {},
  );
  if (!log) return false;

  state.queue.push(log);
  if (state.queue.length >= MAX_BATCH_SIZE) {
    void flushQueue();
  }
  return true;
}

async function flushQueue() {
  if (state.flushing || state.queue.length === 0) return;
  state.flushing = true;

  const batch = state.queue.splice(0, MAX_BATCH_SIZE);
  try {
    const esClient = elasticsearchManager.getClient(SYSTEM_TENANT_ID);
    await esClient.bulkIndex(batch);
    batch.forEach((log) => broadcastToStreams(log, SYSTEM_TENANT_ID));
  } catch (error) {
    state.queue.unshift(...batch.slice(-MAX_BATCH_SIZE));
    console.error('Failed to flush Darwin logs', error);
  } finally {
    state.flushing = false;
  }
}

export function createDarwinLogCaptureMiddleware() {
  return {
    newLogEntry(...entry: unknown[]) {
      const [type, args, bindings] = entry;
      enqueueDarwinLogRecord({ level: type, args, bindings });
    },
  };
}

export function createDarwinLogForwardMiddleware(serviceName: string = 'logs.v1.capture-darwin') {
  let forwarding = false;

  return function darwinLogForwardMiddleware(star: { call?: (name: string, params: DarwinLogRecord) => Promise<unknown> }) {
    return {
      newLogEntry(...entry: unknown[]) {
        if (forwarding || typeof star.call !== 'function') return;

        const [type, args, bindings] = entry;
        forwarding = true;
        star
          .call(serviceName, {
            level: typeof type === 'string' ? type : 'info',
            args: Array.isArray(args) ? args : [],
            bindings: bindings && typeof bindings === 'object' ? bindings as LoggerBindings : {},
          })
          .catch(() => undefined)
          .finally(() => {
            forwarding = false;
          });
      },
    };
  };
}

export function registerDarwinLogForwarding(star: {
  call?: (name: string, params: DarwinLogRecord) => Promise<unknown>;
  middlewares?: { add?: (middleware: unknown) => void } | null;
}) {
  star.middlewares?.add?.(createDarwinLogForwardMiddleware()(star));
}

export function startDarwinLogCapture() {
  state.enabled = true;
  if (!state.timer) {
    state.timer = setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
  }
}

export async function stopDarwinLogCapture() {
  state.enabled = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  await flushQueue();
}

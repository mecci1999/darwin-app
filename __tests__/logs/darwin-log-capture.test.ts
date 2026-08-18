import { LogLevel, LogSource } from '../../src/apps/starlight/logs/types';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../../src/apps/starlight/logs/utils/access-control';
import { LogProcessor } from '../../src/apps/starlight/logs/utils/log-processor';
import {
  createDarwinLogForwardMiddleware,
  DarwinLogRecord,
  enqueueDarwinLogRecord,
  enqueueForwardedDarwinLogRecord,
  flushDarwinLogCaptureForSearch,
  flushDarwinLogCaptureNow,
  searchDarwinFallbackLogs,
} from '../../src/apps/starlight/logs/utils/darwin-log-capture';
import { elasticsearchManager } from '../../src/apps/starlight/logs/utils/elasticsearch-manager';
import captureDarwin from '../../src/apps/starlight/logs/actions/capture-darwin';
import { setDebugDiagnosticsState } from '../../src/apps/starlight/logs/utils/debug-diagnostics';
import type { Context } from 'node-universe';

jest.mock('../../src/apps/starlight/logs/actions/stream', () => ({
  broadcastToStreams: jest.fn(),
}));

jest.mock('../../src/apps/starlight/logs/utils/elasticsearch-manager', () => ({
  elasticsearchManager: {
    isConnected: jest.fn(() => true),
    ensureConnected: jest.fn(async () => true),
    getClient: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(async () => ''),
  mkdir: jest.fn(async () => undefined),
  appendFile: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
}));

const fsPromises = jest.requireMock('fs/promises') as { appendFile: jest.Mock; readFile: jest.Mock };
const mockedElasticsearchManager = elasticsearchManager as jest.Mocked<typeof elasticsearchManager>;

afterEach(() => {
  jest.useRealTimers();
  delete process.env.DARWIN_CAPTURE_DEBUG_LOGS;
  delete process.env.DARWIN_LOG_FORWARD_DIAGNOSTICS;
  jest.restoreAllMocks();
  setDebugDiagnosticsState({ enabled: false });
});

describe('Darwin log contract', () => {
  it('normalizes Darwin app logs as admin-only system logs', () => {
    const processor = new LogProcessor();
    const log = processor.normalizeLog(
      {
        message: 'Logs service started',
        level: LogLevel.INFO,
        source: LogSource.SYSTEM,
        originType: 'darwin-app',
        visibility: 'admin',
        service: 'logs',
        nodeID: 'logs-development',
        namespace: 'darwin-app',
        mod: 'logs',
        svc: 'logs',
        version: '1',
      },
      'system',
    );

    expect(log.tenantId).toBe('system');
    expect(log.originType).toBe('darwin-app');
    expect(log.visibility).toBe('admin');
    expect(log.source).toBe('system');
    expect(log.service).toBe('logs');
    expect(log.namespace).toBe('darwin-app');
  });

  it('keeps user microservice logs tenant visible by default', () => {
    const processor = new LogProcessor();
    const log = processor.normalizeLog(
      {
        message: 'User service log',
        level: LogLevel.INFO,
        service: 'checkout',
      },
      'tenant-1',
    );

    expect(log.tenantId).toBe('tenant-1');
    expect(log.originType).toBe('microservice');
    expect(log.visibility).toBe('tenant');
  });

  it('identifies Darwin log requests as system admin-only scope', () => {
    const ctx = {
      params: { originType: 'darwin-app' },
      meta: { tenantId: 'tenant-1', user: { isAdmin: false } },
    } as unknown as Context;

    expect(isDarwinLogRequest(ctx.params.originType)).toBe(true);
    expect(isAdminContext(ctx)).toBe(false);
    expect(resolveLogTenantId(ctx, 'darwin-app')).toBe('system');
  });

  it('buffers forwarded service logs until the logs capture action is discoverable', async () => {
    jest.useFakeTimers();

    let captureActionAvailable = false;
    const calls: Array<{ name: string; params: DarwinLogRecord | { records: DarwinLogRecord[] } }> = [];
    const star = {
      call: jest.fn(async (name: string, params: DarwinLogRecord | { records: DarwinLogRecord[] }) => {
        calls.push({ name, params });
      }),
      registry: {
        actions: {
            list: jest.fn(() => (
            captureActionAvailable
              ? [{ name: 'logs.v1.capture-darwin', available: true }]
              : []
          )),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('info', ['Gateway request completed'], {
      nodeID: 'gateway-development',
      namespace: 'darwin-app',
      mod: 'gateway',
      svc: 'gateway',
    });

    await jest.advanceTimersByTimeAsync(250);
    expect(star.call).not.toHaveBeenCalled();

    captureActionAvailable = true;
    await jest.advanceTimersByTimeAsync(250);

    expect(star.call).toHaveBeenCalledTimes(1);
    expect(calls[0].name).toBe('logs.v1.capture-darwin');
    expect('records' in calls[0].params ? calls[0].params.records : undefined).toEqual([
      expect.objectContaining({
        level: 'info',
        args: ['Gateway request completed'],
        bindings: expect.objectContaining({ svc: 'gateway' }),
      }),
    ]);
  });

  it('handles wrapped capture responses when forwarding gateway logs', async () => {
    jest.useFakeTimers();

    const star = {
      call: jest.fn(async () => ({
        data: {
          data: {
            content: { accepted: 1 },
          },
        },
      })),
      registry: {
        actions: {
          list: jest.fn(() => [{ name: 'logs.v1.capture-darwin', available: true }]),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('info', ['<= 200 POST /api/logs/v1/explorer/search [+48.403 ms]'], {
      nodeID: 'gateway-development',
      namespace: 'darwin-app',
      mod: 'gateway',
      svc: 'gateway',
    });

    await jest.advanceTimersByTimeAsync(250);

    expect(star.call).toHaveBeenCalledTimes(1);
    expect(fsPromises.appendFile).not.toHaveBeenCalledWith(
      expect.stringContaining('darwin-capture-fallback'),
      expect.stringContaining('capture_action_accepted_zero'),
      'utf8',
    );
  });

  it('does not print gateway forwarding diagnostics unless explicitly enabled', async () => {
    jest.useFakeTimers();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const star = {
      call: jest.fn(async () => ({ data: { content: { accepted: 1 } } })),
      registry: {
        actions: {
          list: jest.fn(() => [{ name: 'logs.v1.capture-darwin', available: true }]),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('info', ['<= 200 POST /api/logs/v1/explorer/search [+48.403 ms]'], {
      nodeID: 'gateway-development',
      namespace: 'darwin-app',
      mod: 'gateway',
      svc: 'gateway',
    });

    await jest.advanceTimersByTimeAsync(250);

    expect(star.call).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalledWith(
      'Darwin gateway log forwarding capture result',
      expect.any(Object),
    );
  });

  it('prints forwarding diagnostics when DARWIN_LOG_FORWARD_DIAGNOSTICS is enabled', async () => {
    jest.useFakeTimers();
    process.env.DARWIN_LOG_FORWARD_DIAGNOSTICS = 'true';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const star = {
      call: jest.fn(async () => ({ data: { content: { accepted: 1 } } })),
      registry: {
        actions: {
          list: jest.fn(() => [{ name: 'logs.v1.capture-darwin', available: true }]),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('info', ['<= 200 POST /api/logs/v1/explorer/search [+48.403 ms]'], {
      nodeID: 'gateway-development',
      namespace: 'darwin-app',
      mod: 'gateway',
      svc: 'gateway',
    });

    await jest.advanceTimersByTimeAsync(250);

    expect(infoSpy).toHaveBeenCalledWith(
      'Darwin gateway log forwarding capture result',
      expect.objectContaining({ accepted: 1, gatewayExplorerRecords: 1 }),
    );
  });

  it('drains queued logs for explicit search flushes without waiting for an Elasticsearch refresh', async () => {
    let releaseFirstFlush: (() => void) | undefined;
    const bulkIndex = jest
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirstFlush = () => resolve({ succeededLogs: [], failedLogs: [], errorItems: [] });
      }))
      .mockResolvedValue({ succeededLogs: [], failedLogs: [], errorItems: [] });
    mockedElasticsearchManager.getClient.mockReturnValue({ bulkIndex } as any);

    expect(enqueueForwardedDarwinLogRecord({
      level: 'info',
      args: ['Auth service started'],
      bindings: {
        nodeID: 'auth-development',
        namespace: 'darwin-app',
        mod: 'auth',
        svc: 'auth',
      },
    })).toBe(true);

    const firstFlush = flushDarwinLogCaptureForSearch();
    await Promise.resolve();

    expect(enqueueForwardedDarwinLogRecord({
      level: 'info',
      args: ['<= 200 POST /api/logs/v1/explorer/search [+153.753 ms]'],
      bindings: {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      },
    })).toBe(true);

    const secondFlush = flushDarwinLogCaptureForSearch();
    releaseFirstFlush?.();
    await firstFlush;
    await secondFlush;

    expect(bulkIndex).toHaveBeenCalledTimes(2);
    expect(bulkIndex.mock.calls[1][0]).toEqual([
      expect.objectContaining({ service: 'gateway', nodeID: 'gateway-development' }),
    ]);
    expect(bulkIndex.mock.calls[1][1]).toEqual({ refresh: undefined });
  });

  it('relies on the regular queue flush for gateway explorer records', async () => {
    const bulkIndex = jest.fn().mockResolvedValue({ succeededLogs: [], failedLogs: [], errorItems: [] });
    mockedElasticsearchManager.getClient.mockReturnValue({ bulkIndex } as any);
    const star = {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };
    const action = captureDarwin(star as any)['v1.capture-darwin'];

    const result = await action.handler({
      params: {
        records: [
          {
            level: 'info',
            args: ['<= 200 POST /api/logs/v1/explorer/search [+153.753 ms]'],
            bindings: {
              nodeID: 'gateway-development',
              namespace: 'darwin-app',
              mod: 'gateway',
              svc: 'gateway',
            },
          },
        ],
      },
    } as unknown as Context);

    expect(result.data.content).toEqual({ accepted: 1 });
    expect(bulkIndex).not.toHaveBeenCalled();

    await flushDarwinLogCaptureNow();

    expect(bulkIndex).toHaveBeenCalledTimes(1);
    expect(bulkIndex.mock.calls[0][1]).toEqual({ refresh: undefined });
  });

  it('persists forwarded gateway logs to fallback when capture action never becomes available', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const star = {
      call: jest.fn(async () => undefined),
      registry: {
        actions: {
          list: jest.fn(() => []),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('info', ['=> POST /api/logs/v1/explorer/search'], {
      nodeID: 'gateway-development',
      namespace: 'darwin-app',
      mod: 'gateway',
      svc: 'gateway',
    });

    await jest.advanceTimersByTimeAsync(5400);

    expect(star.call).not.toHaveBeenCalled();
    expect(fsPromises.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('darwin-capture-fallback'),
      expect.stringContaining('"service":"gateway"'),
      'utf8',
    );
    expect(fsPromises.appendFile.mock.calls[0][1]).toContain('capture_action_unavailable');
  });

  it('opens a forwarding circuit after a capture timeout instead of retrying every flush interval', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const star = {
      call: jest.fn(async () => {
        throw new Error("Request is timed out when call 'logs.v1.capture-darwin' action");
      }),
      registry: {
        actions: {
          list: jest.fn(() => [{ name: 'logs.v1.capture-darwin', available: true }]),
        },
      },
    };

    const middleware = createDarwinLogForwardMiddleware()(star);
    middleware.newLogEntry('warn', ['first log forwarding failure'], { svc: 'gateway' });
    await jest.advanceTimersByTimeAsync(250);
    await Promise.resolve();

    expect(star.call).toHaveBeenCalledTimes(1);
    expect(fsPromises.appendFile.mock.calls.some(([, content]) => String(content).includes('forward_call_failure'))).toBe(true);

    middleware.newLogEntry('warn', ['should wait for the circuit'], { svc: 'gateway' });
    await jest.advanceTimersByTimeAsync(59_000);
    expect(star.call).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_100);
    expect(star.call).toHaveBeenCalledTimes(2);
  });

  it('persists overflow records instead of allowing the forwarding queue to grow unbounded', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fsPromises.appendFile.mockClear();

    let keepFirstForwardingCallOpen: (() => void) | undefined;
    const star = {
      call: jest.fn(() => new Promise((resolve) => {
        keepFirstForwardingCallOpen = () => resolve({ data: { content: { accepted: 20 } } });
      })),
      registry: {
        actions: {
          list: jest.fn(() => [{ name: 'logs.v1.capture-darwin', available: true }]),
        },
      },
    };
    const middleware = createDarwinLogForwardMiddleware()(star);

    for (let index = 0; index < 20; index += 1) {
      middleware.newLogEntry('info', [`queued log ${index}`], {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    expect(keepFirstForwardingCallOpen).toEqual(expect.any(Function));

    for (let index = 20; index < 221; index += 1) {
      middleware.newLogEntry('info', [`queued log ${index}`], {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      });
    }
    keepFirstForwardingCallOpen?.();
    await jest.advanceTimersByTimeAsync(250);

    expect(fsPromises.appendFile.mock.calls.some(([, content]) =>
      String(content).includes('forward_queue_full'),
    )).toBe(true);
  });

  it('accepts remotely forwarded logs before local capture is started', () => {
    const record = {
      level: 'info',
      args: ['Gateway request completed'],
      bindings: {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      },
    };

    expect(enqueueDarwinLogRecord(record)).toBe(false);
    expect(enqueueForwardedDarwinLogRecord(record)).toBe(true);
  });

  it('drops high-volume framework DEBUG logs before storing them', () => {
    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ["Emit 'metrics.raw' event"],
      bindings: {
        nodeID: 'logs-development',
        namespace: 'darwin-app',
        mod: 'star',
      },
    })).toBe(false);

    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ["Emit '$metrics.snapshot' event"],
      bindings: {
        nodeID: 'logs-development',
        namespace: 'darwin-app',
        mod: 'star',
      },
    })).toBe(false);

    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ["<= Request 'logs.v1.capture-darwin' with requestID ' dbb176c6-f16b-4ff9-a69e-506c913b3a5d ' received from 'auth-development' node."],
      bindings: {
        nodeID: 'logs-development',
        namespace: 'darwin-app',
        mod: 'transit',
      },
    })).toBe(false);
  });

  it('drops Darwin DEBUG logs by default before Elasticsearch storage', () => {
    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ['Call action on remote node. {"action":"logs.v1.capture-darwin"}'],
      bindings: {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      },
    })).toBe(false);
  });

  it('accepts forwarded DEBUG logs when runtime debug diagnostics are enabled', () => {
    setDebugDiagnosticsState({ enabled: true, durationMs: 60_000, reason: 'test' });

    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ['HTTP diagnostics request completed', { method: 'GET', url: '/api/logs/v1/explorer/search' }],
      bindings: {
        nodeID: 'starlight-client',
        namespace: 'starlight-client',
        mod: 'client-http',
        svc: 'client-http',
      },
    })).toBe(true);
  });

  it('allows Darwin DEBUG logs when DARWIN_CAPTURE_DEBUG_LOGS is enabled', () => {
    process.env.DARWIN_CAPTURE_DEBUG_LOGS = 'true';

    expect(enqueueForwardedDarwinLogRecord({
      level: 'debug',
      args: ['Call action on remote node. {"action":"logs.v1.capture-darwin"}'],
      bindings: {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      },
    })).toBe(true);
  });

  it('keeps source service attribution for useful forwarded service logs', async () => {
    const record = {
      level: 'info',
      args: ['Auth service started successfully'],
      bindings: {
        nodeID: 'auth-development',
        namespace: 'darwin-app',
        mod: 'star',
      },
    };

    expect(enqueueForwardedDarwinLogRecord(record)).toBe(true);
    fsPromises.readFile.mockResolvedValueOnce([
      JSON.stringify({
        log: {
          id: 'auth-framework-log',
          tenantId: 'system',
          timestamp: '2026-06-15T06:00:00.000Z',
          level: 'info',
          message: 'Auth service started successfully',
          service: 'auth',
          source: 'system',
          originType: 'darwin-app',
          visibility: 'admin',
          nodeID: 'auth-development',
          mod: 'star',
          metadata: { logger: { nodeID: 'auth-development', mod: 'star' } },
          apiKeyId: '',
          indexed: false,
          createdAt: '2026-06-15T06:00:00.000Z',
          updatedAt: '2026-06-15T06:00:00.000Z',
          receivedAt: '2026-06-15T06:00:00.000Z',
        },
      }),
    ].join('\n'));

    const result = await searchDarwinFallbackLogs({
      tenantId: 'system',
      originType: 'darwin-app',
      visibility: 'admin',
      page: 1,
      pageSize: 10,
    });

    expect(result.logs[0]).toEqual(expect.objectContaining({
      service: 'auth',
      nodeID: 'auth-development',
    }));
  });

  it('keeps forwarded gateway request logs visible in Darwin fallback searches', async () => {
    const record = {
      level: 'info',
      args: ['=> POST /api/logs/v1/explorer/search'],
      bindings: {
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
      },
    };

    expect(enqueueForwardedDarwinLogRecord(record)).toBe(true);
    fsPromises.readFile.mockResolvedValueOnce([
      JSON.stringify({
        log: {
          id: 'gateway-request-log',
          tenantId: 'system',
          timestamp: '2026-06-15T09:43:33.604Z',
          level: 'info',
          message: '=> POST /api/logs/v1/explorer/search',
          service: 'gateway',
          source: 'system',
          originType: 'darwin-app',
          visibility: 'admin',
          nodeID: 'gateway-development',
          namespace: 'darwin-app',
          mod: 'gateway',
          svc: 'gateway',
          metadata: { logger: { nodeID: 'gateway-development', mod: 'gateway', svc: 'gateway' } },
          apiKeyId: '',
          indexed: false,
          createdAt: '2026-06-15T09:43:33.604Z',
          updatedAt: '2026-06-15T09:43:33.604Z',
          receivedAt: '2026-06-15T09:43:33.604Z',
        },
      }),
    ].join('\n'));

    const result = await searchDarwinFallbackLogs({
      tenantId: 'system',
      originType: 'darwin-app',
      visibility: 'admin',
      service: 'gateway',
      levels: [LogLevel.INFO],
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.logs[0]).toEqual(expect.objectContaining({
      service: 'gateway',
      nodeID: 'gateway-development',
      message: '=> POST /api/logs/v1/explorer/search',
    }));
  });

  it('can exclude logs collector noise from Darwin fallback searches', async () => {
    fsPromises.readFile.mockResolvedValueOnce([
      JSON.stringify({
        log: {
          id: 'auth-framework-log',
          tenantId: 'system',
          timestamp: '2026-06-15T06:00:00.000Z',
          level: 'info',
          message: 'Auth service started successfully',
          service: 'auth',
          source: 'system',
          originType: 'darwin-app',
          visibility: 'admin',
          nodeID: 'auth-development',
          mod: 'star',
          metadata: { logger: { nodeID: 'auth-development', mod: 'star' } },
          apiKeyId: '',
          indexed: false,
          createdAt: '2026-06-15T06:00:00.000Z',
          updatedAt: '2026-06-15T06:00:00.000Z',
          receivedAt: '2026-06-15T06:00:00.000Z',
        },
      }),
      JSON.stringify({
        log: {
          id: 'logs-collector-log',
          tenantId: 'system',
          timestamp: '2026-06-15T06:01:00.000Z',
          level: 'info',
          message: 'Logs service started successfully',
          service: 'logs',
          source: 'system',
          originType: 'darwin-app',
          visibility: 'admin',
          nodeID: 'logs-development',
          mod: 'logs',
          svc: 'logs',
          metadata: { logger: { nodeID: 'logs-development', mod: 'logs', svc: 'logs' } },
          apiKeyId: '',
          indexed: false,
          createdAt: '2026-06-15T06:01:00.000Z',
          updatedAt: '2026-06-15T06:01:00.000Z',
          receivedAt: '2026-06-15T06:01:00.000Z',
        },
      }),
    ].join('\n'));

    const result = await searchDarwinFallbackLogs({
      tenantId: 'system',
      originType: 'darwin-app',
      visibility: 'admin',
      excludeNodeIDs: ['logs-development'],
      excludeServices: ['logs'],
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.logs[0].service).toBe('auth');
    expect(result.logs[0].nodeID).toBe('auth-development');
  });

});

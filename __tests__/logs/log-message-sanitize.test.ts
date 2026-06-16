import { sanitizeLogMessageText } from '../../src/apps/starlight/logs/utils/log-message-sanitize';
import { LogLevel, LogSource } from '../../src/apps/starlight/logs/types';
import { LogProcessor } from '../../src/apps/starlight/logs/utils/log-processor';

describe('log message sanitization', () => {
  it('strips ANSI color and bold escapes from gateway access logs', () => {
    const message = '<= \x1B[32m\x1B[1m200\x1B[39m\x1B[22m POST \x1B[1m/api/logs/v1/explorer/stats\x1B[22m \x1B[31m[+1.807 s]\x1B[39m';

    expect(sanitizeLogMessageText(message)).toBe('<= 200 POST /api/logs/v1/explorer/stats [+1.807 s]');
  });

  it('stores normalized logs with plain-text messages', () => {
    const processor = new LogProcessor();
    const log = processor.normalizeLog({
      level: LogLevel.INFO,
      source: LogSource.SYSTEM,
      message: '<= \x1B[32m\x1B[1m200\x1B[39m\x1B[22m POST \x1B[1m/api/logs/v1/explorer/search\x1B[22m \x1B[90m[+145.829 ms]\x1B[39m',
      service: 'gateway',
      originType: 'darwin-app',
      visibility: 'admin',
    }, 'system');

    expect(log.message).toBe('<= 200 POST /api/logs/v1/explorer/search [+145.829 ms]');
  });
});

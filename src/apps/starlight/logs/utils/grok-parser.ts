export interface GrokResult {
  level?: string;
  timestamp?: string;
  message?: string;
  service?: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

export class GrokParser {
  private patterns: Map<string, RegExp> = new Map();

  constructor() {
    // NGINX Access Log
    // Example: 127.0.0.1 - - [10/Oct/2020:13:55:36 -0700] "GET /api/v1/users HTTP/1.1" 200 2326
    this.patterns.set(
      'nginx',
      /^(\S+) - (\S+) \[([\w:/]+\s[+\-]\d{4})\] "(\S+) (\S+) (\S+)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"/
    );

    // Syslog (RFC3164)
    // Example: <34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8
    this.patterns.set(
      'syslog',
      /^<(\d+)>([A-M][a-z]{2}\s+\d+\s\d{2}:\d{2}:\d{2})\s(\S+)\s([^:]+):\s(.*)$/
    );

    // Common Log Format (CLF)
    this.patterns.set(
      'clf',
      /^(\S+) \S+ \S+ \[([\w:/]+\s[+\-]\d{4})\] "(\S+) (\S+) (\S+)" (\d{3}) (\d+)/
    );

    // Custom App Log with TraceID
    // Example: [INFO] 2023-01-01T12:00:00.000Z [auth-service] [trace-12345] User logged in
    this.patterns.set(
      'app_trace',
      /^\[([A-Z]+)\]\s+(\S+)\s+\[(\S+)\]\s+\[(\S+)\]\s+(.*)$/
    );
  }

  parse(line: string): GrokResult | null {
    // Try NGINX
    let match = line.match(this.patterns.get('nginx')!);
    if (match) {
      return {
        level: 'info', // NGINX access logs are usually info
        timestamp: match[3], // Need to parse date format
        message: `${match[4]} ${match[5]} ${match[7]}`,
        service: 'nginx',
        metadata: {
          client_ip: match[1],
          method: match[4],
          path: match[5],
          status: match[7],
          bytes: match[8],
          referer: match[9],
          user_agent: match[10],
        },
      };
    }

    // Try Syslog
    match = line.match(this.patterns.get('syslog')!);
    if (match) {
      return {
        level: 'info', // Extract from pri <d> later if needed
        timestamp: match[2],
        service: match[3], // hostname
        message: `${match[4]}: ${match[5]}`,
        metadata: {
          process: match[4],
        },
      };
    }

    // Try App Trace
    match = line.match(this.patterns.get('app_trace')!);
    if (match) {
      return {
        level: match[1],
        timestamp: match[2],
        service: match[3],
        traceId: match[4],
        message: match[5],
      };
    }

    return null;
  }
}

export const grokParser = new GrokParser();

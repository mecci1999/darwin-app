export interface VerificationEmailConfig {
  enabled: boolean;
  from: string;
  host: string;
  password: string;
  port: number;
  secure: boolean;
  user: string;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const readRequired = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when EMAIL_ENABLED is true`);
  }
  return value;
};

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  return port;
};

const parseEnabled = (value: string | undefined): boolean => {
  if (value === undefined || !value.trim()) return true;
  return TRUE_VALUES.has(value.trim().toLowerCase());
};

export const resolveVerificationEmailConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): VerificationEmailConfig => {
  const enabled = parseEnabled(environment.EMAIL_ENABLED);
  if (!enabled) {
    return {
      enabled: false,
      from: '',
      host: '',
      password: '',
      port: 0,
      secure: false,
      user: '',
    };
  }

  const host = readRequired(environment, 'SMTP_HOST');
  const user = readRequired(environment, 'SMTP_USER');
  const password = readRequired(environment, 'SMTP_PASSWORD');
  const fromEmail = readRequired(environment, 'FROM_EMAIL');
  const fromName = environment.FROM_NAME?.trim();
  const port = parsePort(readRequired(environment, 'SMTP_PORT'));
  const secure = TRUE_VALUES.has((environment.SMTP_SECURE || '').trim().toLowerCase());

  return {
    enabled,
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    host,
    password,
    port,
    secure,
    user,
  };
};

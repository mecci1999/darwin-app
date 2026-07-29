import { resolveVerificationEmailConfig } from '../../src/core/auth/config/mail';

const enabledEnvironment: NodeJS.ProcessEnv = {
  EMAIL_ENABLED: 'true',
  FROM_EMAIL: 'noreply@example.com',
  FROM_NAME: '星光',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PASSWORD: 'test-smtp-password',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'noreply@example.com',
};

describe('resolveVerificationEmailConfig', () => {
  it('rejects missing required SMTP credentials when email delivery is enabled', () => {
    expect(() => resolveVerificationEmailConfig({ ...enabledEnvironment, SMTP_PASSWORD: '  ' })).toThrow(
      'SMTP_PASSWORD is required when EMAIL_ENABLED is true',
    );
  });

  it('rejects an invalid SMTP port', () => {
    expect(() => resolveVerificationEmailConfig({ ...enabledEnvironment, SMTP_PORT: '70000' })).toThrow(
      'SMTP_PORT must be an integer between 1 and 65535',
    );
  });

  it('returns the SMTP transport and sender from environment configuration', () => {
    expect(resolveVerificationEmailConfig(enabledEnvironment)).toEqual({
      enabled: true,
      from: '星光 <noreply@example.com>',
      host: 'smtp.example.com',
      password: 'test-smtp-password',
      port: 465,
      secure: true,
      user: 'noreply@example.com',
    });
  });

  it('allows an explicitly disabled email service without SMTP secrets', () => {
    expect(resolveVerificationEmailConfig({ EMAIL_ENABLED: 'false' })).toMatchObject({
      enabled: false,
    });
  });
});

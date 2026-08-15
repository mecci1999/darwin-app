const sendMail = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
const close = jest.fn();
const createTransport = jest.fn(() => ({ sendMail, close }));

jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport } }));
jest.mock('../../src/core/auth/config/mail', () => ({ resolveVerificationEmailConfig: jest.fn(() => ({ enabled: true, from: 'Darwin <alerts@example.test>', host: 'smtp.example.test', port: 587, secure: false, user: 'alert-user', password: 'secret' })) }));

import { deliverEmail } from '../../src/apps/starlight/metrics-alerts/smtp-delivery';

const delivery = { deliveryId: 'delivery-1', tenantId: 'system', eventId: 'event-1', alertId: 'alert-1', channel: 'Email' as const, target: { address: 'ops@example.test' }, payload: { level: 'critical', message: 'auth missing' }, attempts: 0, leaseToken: 'lease-1' };

describe('metrics-alert SMTP delivery', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends directly to SMTP and closes the transport', async () => {
    sendMail.mockResolvedValue({});
    await expect(deliverEmail(delivery, 20)).resolves.toBeUndefined();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeout: 20, greetingTimeout: 20, socketTimeout: 20 }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@example.test' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates SMTP errors and closes the transport for durable retry', async () => {
    sendMail.mockRejectedValue(new Error('smtp unavailable'));
    await expect(deliverEmail(delivery, 20)).rejects.toThrow('smtp unavailable');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('times out and closes a stalled SMTP transport', async () => {
    sendMail.mockReturnValue(new Promise(() => undefined));
    await expect(deliverEmail(delivery, 5)).rejects.toThrow('SMTP delivery timed out');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

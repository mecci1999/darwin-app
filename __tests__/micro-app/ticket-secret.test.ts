import { requireMicroAppTicketSecret } from '../../src/apps/starlight/micro-app/actions';

describe('micro-app ticket secret', () => {
  const originalSecret = process.env.MICRO_APP_TICKET_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.MICRO_APP_TICKET_SECRET;
    } else {
      process.env.MICRO_APP_TICKET_SECRET = originalSecret;
    }
  });

  it('rejects absent or whitespace-only secrets', () => {
    process.env.MICRO_APP_TICKET_SECRET = '   ';

    expect(requireMicroAppTicketSecret).toThrow('MICRO_APP_TICKET_SECRET is required');
  });

  it('returns an explicit non-empty secret', () => {
    process.env.MICRO_APP_TICKET_SECRET = 'test-ticket-secret';

    expect(requireMicroAppTicketSecret()).toBe('test-ticket-secret');
  });
});

import { isCurrentWebSocketClient } from '../../src/core/gateway/methods/websocket-client-lifecycle';

describe('gateway WebSocket client lifecycle', () => {
  it('does not treat an old socket as the current client after a same-clientId reconnect', () => {
    const oldClient = {
      id: 'same-client-id',
      ws: {},
      subscriptions: new Set<string>(),
      isAlive: true,
      isAuthenticated: false,
    };
    const replacementClient = {
      ...oldClient,
      ws: {},
    };

    expect(isCurrentWebSocketClient(replacementClient, oldClient)).toBe(false);
    expect(isCurrentWebSocketClient(replacementClient, replacementClient)).toBe(true);
  });
});

export const isCurrentWebSocketClient = <T extends { ws: unknown }>(
  currentClient: T | undefined,
  disconnectingClient: T,
) => currentClient?.ws === disconnectingClient.ws;

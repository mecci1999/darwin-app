import { EventEmitter } from 'events';
import { Starlight } from '../../src/typings';
import { createGatewayRegistryObservability } from '../../src/core/gateway/registry-observability';

describe('gateway registry observability', () => {
  it('records only high-signal framework transitions with sanitized fields', () => {
    const localBus = new EventEmitter();
    const star = {
      localBus,
      logger: { info: jest.fn(), warn: jest.fn() },
    } as unknown as Starlight;
    const observer = createGatewayRegistryObservability(star);

    localBus.emit('$node.connected', { node: { id: 'metrics-production-metrics' }, reconnected: false });
    localBus.emit('$node.disconnected', { node: { id: 'metrics-production-metrics' }, unexpected: true });
    localBus.emit('$transporter.error', { type: 'FAILED_PUBLISHER_ERROR', error: { password: 'must-not-log' } });

    expect(star.logger?.info).not.toHaveBeenCalled();
    expect(star.logger?.warn).toHaveBeenCalledTimes(2);
    expect(star.logger?.warn).toHaveBeenCalledWith(
      'gateway.registry-diagnostic',
      expect.objectContaining({ event: 'node_disconnected', service: 'metrics', reason: 'heartbeat_or_transport' }),
    );
    expect(star.logger?.warn).toHaveBeenCalledWith(
      'gateway.registry-diagnostic',
      expect.objectContaining({ event: 'transporter_error', reason: 'failed_publisher_error' }),
    );
    expect(JSON.stringify((star.logger?.warn as jest.Mock).mock.calls)).not.toContain('must-not-log');
    observer.stop();
  });

  it('rate limits duplicate diagnostics and detaches listeners on stop', () => {
    jest.useFakeTimers();
    const localBus = new EventEmitter();
    const star = {
      localBus,
      logger: { info: jest.fn(), warn: jest.fn() },
    } as unknown as Starlight;
    const observer = createGatewayRegistryObservability(star);

    localBus.emit('$transit.error', { type: 'FAILED_SEND_HEARTBEAT_PACKET' });
    localBus.emit('$transit.error', { type: 'FAILED_SEND_HEARTBEAT_PACKET' });
    expect(star.logger?.warn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    localBus.emit('$transit.error', { type: 'FAILED_SEND_HEARTBEAT_PACKET' });
    expect(star.logger?.warn).toHaveBeenCalledTimes(2);
    observer.stop();
    localBus.emit('$transit.error', { type: 'FAILED_SEND_HEARTBEAT_PACKET' });
    expect(star.logger?.warn).toHaveBeenCalledTimes(2);
  });
});

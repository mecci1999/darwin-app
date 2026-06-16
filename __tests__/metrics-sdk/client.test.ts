import { describe, expect, it, vi } from 'vitest';
import { MetricsClient } from '../../src/apps/starlight/metrics/sdk';

const createOkResponse = (status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => ''),
  }) as unknown as Response;

describe('MetricsClient topology instrumentation', () => {
  it('flushes topology metrics to the ingest endpoint', async () => {
    const fetchMock = vi.fn(async () => createOkResponse());
    vi.stubGlobal('fetch', fetchMock);
    const client = new MetricsClient({
      endpoint: 'https://collector.example.com/api/metrics',
      appKey: 'ak_test',
      serviceName: 'checkout-service',
      flushInterval: 60_000,
      maxBatchSize: 10,
    });

    client.recordHttpCall({
      targetService: 'payment-service',
      method: 'POST',
      route: '/payments',
      statusCode: 201,
      durationMs: 42,
      tags: { env: 'test' },
    });

    await client.flushNow();
    await client.stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(requestInit?.body));
    expect(body).toMatchObject({ appKey: 'ak_test', dataType: 'standard' });
    expect(body.data).toHaveLength(2);

    const requestMetric = body.data.find((item: any) => item.metric === 'http_requests_total');
    const durationMetric = body.data.find((item: any) => item.metric === 'http_request_duration_ms');

    expect(requestMetric.tags).toMatchObject({
      service: 'checkout-service',
      source_service: 'checkout-service',
      target_service: 'payment-service',
      targetService: 'payment-service',
      destination_service: 'payment-service',
      peer_service: 'payment-service',
      method: 'POST',
      route: '/payments',
      status: '201',
      env: 'test',
    });
    expect(requestMetric.value).toBe(1);
    expect(durationMetric.value).toBe(42);
    expect(durationMetric.tags).toMatchObject({
      target_service: 'payment-service',
      phase: 'finish',
      unit: 'ms',
    });

    vi.unstubAllGlobals();
  });

  it('wraps fetch and records failed calls as topology edges', async () => {
    const fetchMock = vi.fn(async () => createOkResponse(503));
    vi.stubGlobal('fetch', vi.fn(async () => createOkResponse()));
    const client = new MetricsClient({
      endpoint: 'https://collector.example.com/api/metrics',
      appKey: 'ak_test',
      serviceName: 'checkout-service',
      flushInterval: 60_000,
      maxBatchSize: 10,
    });
    const wrappedFetch = client.instrumentFetch(fetchMock as unknown as typeof fetch, {
      targetService: 'inventory-service',
      route: '/inventory/reserve',
    });

    await wrappedFetch('https://inventory.example.com/inventory/reserve', { method: 'PUT' });
    await client.flushNow();
    await client.stop();

    const ingestFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(String(ingestFetch.mock.calls[0][1]?.body));
    const requestMetric = body.data.find((item: any) => item.metric === 'http_requests_total');

    expect(requestMetric.tags).toMatchObject({
      source_service: 'checkout-service',
      target_service: 'inventory-service',
      method: 'PUT',
      route: '/inventory/reserve',
      status: '503',
    });

    vi.unstubAllGlobals();
  });
});

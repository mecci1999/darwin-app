import { MetricsBatch } from '../types';

export type MetricsProcessingQueueState = {
  processingQueue: MetricsBatch[];
};

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_METRICS_QUEUE_BATCHES = positiveInteger(process.env.METRICS_MAX_QUEUE_BATCHES, 250);
export const MAX_METRICS_QUEUE_ITEMS = positiveInteger(process.env.METRICS_MAX_QUEUE_ITEMS, 20_000);
export const MAX_METRICS_FLUSH_BATCHES = positiveInteger(process.env.METRICS_MAX_FLUSH_BATCHES, 100);
export const MAX_METRICS_FLUSH_ITEMS = positiveInteger(process.env.METRICS_MAX_FLUSH_ITEMS, 5_000);

const batchItemCount = (batch: MetricsBatch) => Array.isArray(batch.data) ? batch.data.length : 0;

export const metricsQueueItemCount = (queue: MetricsBatch[]) => queue.reduce((total, batch) => total + batchItemCount(batch), 0);

/**
 * Bounded in-memory transport for telemetry. When the sink is unavailable,
 * recent measurements are more useful than an unbounded heap that restarts
 * every service on a small host.
 */
export const enqueueMetricsBatch = (state: MetricsProcessingQueueState, batch: MetricsBatch): boolean => {
  if (!Array.isArray(batch.data) || batch.data.length === 0) return false;

  const queue = state.processingQueue;
  const currentItems = metricsQueueItemCount(queue);
  if (queue.length >= MAX_METRICS_QUEUE_BATCHES || currentItems + batch.data.length > MAX_METRICS_QUEUE_ITEMS) {
    return false;
  }

  queue.push(batch);
  return true;
};

export const takeMetricsFlushBatch = (state: MetricsProcessingQueueState): MetricsBatch[] => {
  if (state.processingQueue.length === 0) return [];

  const batches: MetricsBatch[] = [];
  let itemCount = 0;
  while (state.processingQueue.length > 0 && batches.length < MAX_METRICS_FLUSH_BATCHES) {
    const next = state.processingQueue[0];
    const nextItemCount = batchItemCount(next);
    if (batches.length > 0 && itemCount + nextItemCount > MAX_METRICS_FLUSH_ITEMS) break;
    state.processingQueue.shift();
    batches.push(next);
    itemCount += nextItemCount;
  }
  return batches;
};

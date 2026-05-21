export const MEMORY_USAGE_UNIT = 'MB';
export const MEMORY_USAGE_PERCENT_UNIT = '%';

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const bytesToMegabytes = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0;
  return Number((value / BYTES_PER_MEGABYTE).toFixed(digits));
};

export const normalizeRssMemoryValue = (value: unknown, digits = 2) => {
  const numericValue = Number(value || 0);
  return bytesToMegabytes(numericValue, digits);
};

export const calculateMemoryUsagePercent = (usedBytes: unknown, totalBytes: unknown, digits = 2) => {
  const used = Number(usedBytes || 0);
  const total = Number(totalBytes || 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Number(Math.min(100, Math.max(0, (used / total) * 100)).toFixed(digits));
};

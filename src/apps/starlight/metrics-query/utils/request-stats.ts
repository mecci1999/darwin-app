const REQUEST_COUNT_FIELD_PRIORITY: Record<string, number> = {
  value: 3,
  count: 2,
  total: 1,
};

const resolveRequestStatsLabel = (row: any) => {
  const targetService = String(row?.stat_target || row?.target_service || row?.targetService || row?.destination_service || row?.peer_service || '').trim();
  const sourceService = String(row?.service || row?.source_service || row?.serviceId || '').trim();
  const route = String(row?.stat_route || row?.route || row?.action || row?.endpoint || '').trim();
  const method = String(row?.stat_method || row?.method || '').trim();
  const target = targetService || sourceService || '未知服务';
  const operation = route ? (method && method !== 'HTTP' ? `${method} ${route}` : route) : '';
  return operation ? `${target} · ${operation}` : target;
};

export const buildRequestStatsDistributionItems = (rows: any[], limit = 8) => {
  const fieldValuesByLabel = new Map<string, Map<string, number>>();

  rows.forEach((row) => {
    const value = Number(row?._value || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    const label = resolveRequestStatsLabel(row);
    const field = String(row?._field || 'value');
    const valuesByField = fieldValuesByLabel.get(label) || new Map<string, number>();
    valuesByField.set(field, (valuesByField.get(field) || 0) + value);
    fieldValuesByLabel.set(label, valuesByField);
  });

  return Array.from(fieldValuesByLabel.entries())
    .map(([name, valuesByField]) => {
      const bestField = Array.from(valuesByField.keys()).sort(
        (left, right) => (REQUEST_COUNT_FIELD_PRIORITY[right] || 0) - (REQUEST_COUNT_FIELD_PRIORITY[left] || 0)
      )[0];
      return { name, value: Math.round(valuesByField.get(bestField) || 0) };
    })
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
};

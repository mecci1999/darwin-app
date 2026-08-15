const INTERNAL_ONLY_SERVICES = new Set(['metrics-alerts', 'metrics-compat', 'metrics-query', 'subscription-billing']);
export const isInternalOnlyPublicService = (service: string) => INTERNAL_ONLY_SERVICES.has(service);

export const resolveGatewayErrorStatus = (error: unknown, seen = new Set<unknown>()): number => {
  if (!error || typeof error !== 'object') return 500;
  if (seen.has(error)) return 500;
  seen.add(error);
  const candidate = error as { code?: unknown; data?: { status?: unknown }; message?: unknown };
  if (
    typeof candidate.data?.status === 'number' &&
    candidate.data.status >= 400 &&
    candidate.data.status <= 599
  ) {
    return candidate.data.status;
  }
  const nestedStatus = resolveGatewayErrorStatus(candidate.message, seen);
  if (nestedStatus !== 500) return nestedStatus;
  if (typeof candidate.code === 'number' && candidate.code >= 400 && candidate.code <= 599) {
    return candidate.code;
  }
  return 500;
};

export const remapMetricsPublicRoute = (
  rawService: string,
  rawVersion: string,
  rawAction: string,
  rawParams: Record<string, unknown> = {},
) => {
  if (rawService !== 'metrics') return { service: rawService, action: rawAction, params: { ...rawParams } };
  const params = { ...rawParams };
  if ((rawVersion === 'v1' || rawVersion === '1') && (rawAction === 'registry-missing-alert-rules' || rawAction === 'registry-missing-alert-rules/create')) return { service: 'metrics-alerts', action: rawAction, params };
  const registryMissingRuleDeleteMatch = rawAction.match(/^registry-missing-alert-rules\/([^/]+)\/delete$/);
  const registryMissingRuleUpdateMatch = rawAction.match(/^registry-missing-alert-rules\/([^/]+)$/);
  if (registryMissingRuleDeleteMatch) return { service: 'metrics-alerts', action: 'registry-missing-alert-rules/:id/delete', params: { ...params, id: registryMissingRuleDeleteMatch[1] } };
  if (registryMissingRuleUpdateMatch) return { service: 'metrics-alerts', action: 'registry-missing-alert-rules/:id', params: { ...params, id: registryMissingRuleUpdateMatch[1] } };
  return { service: rawService, action: rawAction, params };
};

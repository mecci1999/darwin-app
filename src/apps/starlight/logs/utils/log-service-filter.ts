export function getLogServiceFilter(params: any) {
  const explicitLogService = typeof params?.logService === 'string' ? params.logService.trim() : '';
  if (explicitLogService) return explicitLogService;

  const routeService = typeof params?.routeService === 'string' ? params.routeService : undefined;
  const service = typeof params?.service === 'string' ? params.service.trim() : '';
  if (!service || service === 'logs' || service === routeService) return undefined;

  return service;
}

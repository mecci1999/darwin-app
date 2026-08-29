export const prepareGatewayDispatch = <TMeta, TParams>(
  trustedMeta: TMeta,
  params: TParams,
) => ({
  meta: trustedMeta,
  params,
});

/**
 * Trails derives the caller exclusively from trusted gateway metadata. Route
 * matching fields are transport details, not part of any Trails request body.
 */
export const stripTrailsGatewayRouteFields = (params: Record<string, unknown>) => {
  const {
    routeService: _routeService,
    service: _service,
    version: _version,
    action: _action,
    userId: _userId,
    ...requestParams
  } = params;
  return requestParams;
};

const selectRequestFields = (
  params: Record<string, unknown>,
  fields: readonly string[],
) => Object.fromEntries(
  fields.flatMap((field) => (
    Object.prototype.hasOwnProperty.call(params, field)
      ? [[field, params[field]] as const]
      : []
  )),
);

/**
 * Native Trails calls share Gateway's route-parameter container. Rebuild every
 * supported iOS payload from its API contract so route or transport metadata
 * can never reach a strict Trails action.
 */
export const normalizeTrailsGatewayRequestParams = (
  params: Record<string, unknown>,
  version: unknown,
  action: unknown,
) => {
  const requestParams = stripTrailsGatewayRouteFields(params);
  const requestVersion = String(version);
  const requestAction = String(action);
  const key = `${requestVersion}:${requestAction}`;
  const emptyPayloadRequests = new Set([
    'v2:field-records/workspace',
    'v2:shooting-locations/workspace',
    'v1:shooting-scenes/workspace',
    'v2:trip-registrations/mine-list',
    'v2:trip-payments/workspace',
    'v2:portfolios/workspace',
    'v2:field-plans/workspace',
    'v3:field-plans/workspace',
    'v4:field-plans/workspace',
    'v5:field-plans/workspace',
  ]);
  if (emptyPayloadRequests.has(key)) return {};

  const fieldsByRequest: Record<string, readonly string[]> = {
    'v1:weather/forecast': ['latitude', 'longitude', 'provider'],
    'v1:night-sky/forecast': ['latitude', 'longitude', 'date', 'timeZone'],
    'v2:analytics/workspace': ['from', 'to'],
    'v2:operations/workspace': ['from', 'to'],
    'v2:portfolios/public': ['categorySlug'],
    'v1:field-record-events/workspace': ['fieldPlanId'],
    'v1:field-record-events/append': ['id', 'fieldPlanId', 'type', 'occurredAt', 'body', 'expectedPlanResourceVersion', 'mutationId'],
    'v1:shooting-knowledge/workspace': ['kind', 'cursor'],
    'v2:shooting-knowledge/workspace': ['kind', 'cursor'],
    'v1:shooting-knowledge/mutate': ['operation', 'id', 'kind', 'title', 'body', 'category', 'tags', 'pinned', 'mutationId', 'expectedResourceVersion'],
    'v2:shooting-knowledge/mutate': ['operation', 'id', 'kind', 'title', 'body', 'category', 'tags', 'scenes', 'pinned', 'mutationId', 'expectedResourceVersion'],
    'v1:shooting-scenes/mutate': ['operation', 'id', 'label', 'shortLabel', 'description', 'executionHint', 'quickReferenceHint', 'workbenchFocus', 'workbenchSteps', 'mutationId', 'expectedResourceVersion'],
    'v2:shooting-locations/create': ['id', 'name', 'latitude', 'longitude', 'notes', 'mutationId', 'expectedResourceVersion'],
    'v2:shooting-locations/update': ['id', 'name', 'latitude', 'longitude', 'notes', 'mutationId', 'expectedResourceVersion'],
    'v2:shooting-locations/archive': ['id', 'mutationId', 'expectedResourceVersion'],
    'v2:field-records/save': ['fieldPlanId', 'weatherNote', 'observation', 'exceptionReason', 'mutationId', 'expectedResourceVersion'],
    'v2:field-records/delete': ['fieldPlanId', 'mutationId', 'expectedResourceVersion'],
    'v5:field-plans/create': ['id', 'title', 'shootingLocationId', 'locationLabel', 'plannedFor', 'plannedStartAt', 'plannedEndAt', 'preparation', 'permit', 'shotChecklist', 'scenes', 'guideIds', 'decisionThresholds', 'mutationId', 'expectedResourceVersion'],
    'v5:field-plans/update': ['id', 'mutationId', 'expectedResourceVersion', 'title', 'shootingLocationId', 'locationLabel', 'plannedFor', 'plannedStartAt', 'plannedEndAt', 'preparation', 'permit', 'shotChecklist', 'scenes', 'guideIds', 'decisionThresholds', 'postProduction', 'arrivedAt', 'departedAt', 'cancellationReasonCode', 'cancellationReasonText'],
    'v5:field-plans/reschedule': ['id', 'mutationId', 'expectedResourceVersion', 'plannedFor', 'plannedStartAt', 'plannedEndAt'],
    'v5:field-plans/transition': ['id', 'mutationId', 'expectedResourceVersion', 'status', 'occurredAt', 'cancellationReasonCode', 'cancellationReasonText'],
    'v5:field-plans/archive': ['id', 'mutationId', 'expectedResourceVersion'],
  };
  const fields = fieldsByRequest[key];
  if (fields) return selectRequestFields(requestParams, fields);

  // Non-native or future Trails routes retain their existing server contract.
  // They still never receive Gateway's known routing/identity fields.
  return requestParams;
};

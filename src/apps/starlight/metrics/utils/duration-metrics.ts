export const PROTOCOL_DURATION_METRIC_REFS = [
  'universe.request.time',
  'http_request_duration_ms',
  'http_request_duration',
  'rpc_duration_ms',
  'messaging_duration_ms',
  'db_query_duration_ms',
];

export const isProtocolDurationMetricRef = (metricRef: string) => PROTOCOL_DURATION_METRIC_REFS.includes(metricRef);

export const RESPONSE_DURATION_MEASUREMENT_FILTER =
  'r["_measurement"] == "universe.request.time" or r["_measurement"] == "http_request_duration_ms" or r["_measurement"] == "http_request_duration" or r["_measurement"] == "rpc_duration_ms" or r["_measurement"] == "messaging_duration_ms" or r["_measurement"] == "db_query_duration_ms"';

export const RESPONSE_DURATION_FIELD_FILTER =
  'r["_field"] == "value" or r["_field"] == "duration" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time"';

export const RESPONSE_DURATION_COMPLETED_REQUEST_FILTER =
  '|> filter(fn: (r) => (not exists r.phase or r.phase != "start") and float(v: r["_value"]) > 0.0)';

export const RESPONSE_DURATION_MS_NORMALIZATION_FLUX =
  '|> map(fn: (r) => ({ r with _value: if r["_measurement"] == "http_request_duration" and (not exists r.unit or r.unit == "s" or r.unit == "second" or r.unit == "seconds") then float(v: r["_value"]) * 1000.0 else float(v: r["_value"]) }))';

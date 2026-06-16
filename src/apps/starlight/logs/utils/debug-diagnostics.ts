const DEFAULT_DEBUG_DURATION_MS = 10 * 60 * 1000;
const MAX_DEBUG_DURATION_MS = 30 * 60 * 1000;

export type DebugDiagnosticsState = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy?: string;
  expiresAt: string | null;
  reason?: string;
};

let debugDiagnosticsState: DebugDiagnosticsState = {
  enabled: false,
  updatedAt: null,
  expiresAt: null,
};

function normalizeState(): DebugDiagnosticsState {
  if (
    debugDiagnosticsState.enabled &&
    debugDiagnosticsState.expiresAt &&
    Date.parse(debugDiagnosticsState.expiresAt) <= Date.now()
  ) {
    debugDiagnosticsState = {
      ...debugDiagnosticsState,
      enabled: false,
      expiresAt: null,
      reason: 'expired',
    };
  }

  return debugDiagnosticsState;
}

export function getDebugDiagnosticsState(): DebugDiagnosticsState {
  return { ...normalizeState() };
}

export function setDebugDiagnosticsState(input: {
  enabled: boolean;
  durationMs?: number;
  updatedBy?: string;
  reason?: string;
}): DebugDiagnosticsState {
  const now = Date.now();
  const durationMs = Math.min(
    Math.max(input.durationMs || DEFAULT_DEBUG_DURATION_MS, 1_000),
    MAX_DEBUG_DURATION_MS,
  );

  debugDiagnosticsState = {
    enabled: input.enabled,
    updatedAt: new Date(now).toISOString(),
    updatedBy: input.updatedBy,
    expiresAt: input.enabled ? new Date(now + durationMs).toISOString() : null,
    reason: input.reason,
  };

  return getDebugDiagnosticsState();
}

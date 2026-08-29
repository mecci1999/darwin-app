const enabledValue = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Node-Universe emits a full process metrics snapshot on a timer. Keep it
 * intentionally sparse in production and let low-priority services opt out.
 */
export const createServiceMetricsOptions = (defaultIntervalSeconds?: number) => {
  const defaultInterval = defaultIntervalSeconds ?? (process.env.NODE_ENV === 'production' ? 60 : 5);
  if (!enabledValue(process.env.DARWIN_SERVICE_METRICS, true)) {
    return { enabled: false };
  }

  const interval = positiveInteger(process.env.DARWIN_SERVICE_METRICS_INTERVAL_SECONDS, defaultInterval);
  return {
    enabled: true,
    collectInterval: interval,
    reporter: {
      type: 'Event',
      options: {
        interval,
        onlyChanges: true,
      },
    },
  };
};

/**
 * Keep idle Kafka consumers parked at the broker for longer in production.
 * A record still returns immediately because fetch.min.bytes is one; this only
 * avoids every Node-Universe endpoint issuing a new empty fetch ten times/sec.
 */
export const createKafkaConsumerOptions = () => {
  const defaultWait = process.env.NODE_ENV === 'production' ? 1000 : 100;
  return {
    'fetch.min.bytes': 1,
    'fetch.wait.max.ms': positiveInteger(process.env.DARWIN_KAFKA_FETCH_WAIT_MAX_MS, defaultWait),
  };
};

type NodeUniverseRuntime = {
  nodeID?: string | null;
  instanceID: string;
  transit?: { instanceID?: string } | null;
  registry?: { nodes?: { localNode?: { instanceID?: string | null } | null } } | null;
};

const normalizeInstanceSegment = (value: string, fallback: string) => {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  return normalized || fallback;
};

/**
 * node-universe uses instanceID as the actual Kafka consumer group ID, taking
 * precedence over transporter.options.consumer.groupId. A random ID on every
 * container restart leaves permanently empty groups behind. Keep it stable for
 * one deployment epoch, but change it deliberately on a code rollout so peer
 * registries still receive an instance transition when service schemas change.
 */
export const stabilizeNodeUniverseInstanceId = (star: NodeUniverseRuntime) => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!enabledValue(process.env.DARWIN_STABLE_UNIVERSE_INSTANCE_ID, true)) return;

  const nodeID = normalizeInstanceSegment(String(star.nodeID || ''), 'unknown-node');
  const epoch = normalizeInstanceSegment(process.env.DARWIN_UNIVERSE_INSTANCE_EPOCH || 'production', 'production');
  const instanceID = `${epoch}-${nodeID}`;

  star.instanceID = instanceID;
  if (star.transit) star.transit.instanceID = instanceID;
  const localNode = star.registry?.nodes?.localNode;
  if (localNode) localNode.instanceID = instanceID;
};

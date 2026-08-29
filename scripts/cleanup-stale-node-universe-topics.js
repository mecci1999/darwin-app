/*
 * Removes endpoint topics left behind by old one-off Node-Universe diagnostic
 * nodes. The script deliberately fails closed: it accepts only the expected
 * namespace/topic shape and refuses every active production node identity.
 *
 * Usage (inside an application container):
 *   node cleanup-stale-node-universe-topics.js /path/to/topics.txt --dry-run
 *   node cleanup-stale-node-universe-topics.js /path/to/topics.txt --apply
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Kafka, logLevel } = require('kafkajs');

const ACTIVE_NODE_IDS = new Set([
  'gateway-production-gateway',
  'auth-production-auth',
  'user-production-user',
  'file-production-file',
  'metrics-production-metrics',
  'metrics-query-production-metrics-query',
  'metrics-alerts-production-metrics-alerts',
  'metrics-compat-production-metrics-compat',
  'logs-production-logs',
  'subscription-production-subscription',
  'video-production-video',
  'micro-app-production-micro-app',
  'trails-production-trails',
  'registry-inspector-production',
]);

const ENDPOINT_TOPIC = /^Universer-darwin-app\.(?:EVENT|REQ|RES|DISCOVER|INFO|PING|PONG)\.([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 2000;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const readTopics = filePath => {
  const contents = fs.readFileSync(filePath, 'utf8');
  const topics = contents.split(/\r?\n/).map(topic => topic.trim()).filter(Boolean);

  if (topics.length === 0) throw new Error('Topic manifest is empty; refusing to continue');
  if (topics.length > 2000) throw new Error(`Topic manifest has ${topics.length} entries; refusing an unexpected batch`);
  if (new Set(topics).size !== topics.length) throw new Error('Topic manifest contains duplicates; refusing to continue');

  for (const topic of topics) {
    const match = ENDPOINT_TOPIC.exec(topic);
    if (!match) throw new Error(`Unexpected topic format: ${topic}`);
    if (ACTIVE_NODE_IDS.has(match[1])) throw new Error(`Active production topic found in manifest: ${topic}`);
  }

  return { contents, topics };
};

const resolveBrokers = () => {
  const value = String(process.env.KAFKA_BROKERS || process.env.KAFKA_HOST || '').trim();
  const brokers = value
    .split(',')
    .map(broker => broker.trim().replace(/^kafka:\/\//, ''))
    .filter(Boolean);

  if (brokers.length === 0) throw new Error('KAFKA_BROKERS or KAFKA_HOST is required');
  return brokers;
};

const run = async () => {
  const [manifestPath, command] = process.argv.slice(2);
  if (!manifestPath || !['--dry-run', '--apply'].includes(command)) {
    throw new Error('Usage: node cleanup-stale-node-universe-topics.js <manifest> <--dry-run|--apply>');
  }

  const { contents, topics } = readTopics(manifestPath);
  const checksum = crypto.createHash('sha256').update(contents).digest('hex');
  console.log(`VALIDATED_TOPICS=${topics.length}`);
  console.log(`MANIFEST_SHA256=${checksum}`);

  if (command === '--dry-run') {
    console.log('DRY_RUN=1');
    return;
  }

  const kafka = new Kafka({
    clientId: 'darwin-app-stale-topic-cleanup',
    brokers: resolveBrokers(),
    logLevel: logLevel.NOTHING,
    retry: { retries: 3, initialRetryTime: 1000, maxRetryTime: 5000 },
  });
  const admin = kafka.admin();

  await admin.connect();
  try {
    for (let index = 0; index < topics.length; index += BATCH_SIZE) {
      const batch = topics.slice(index, index + BATCH_SIZE);
      await admin.deleteTopics({ topics: batch, timeout: 30000 });
      console.log(`DELETED_BATCH=${Math.floor(index / BATCH_SIZE) + 1} COUNT=${batch.length}`);
      if (index + BATCH_SIZE < topics.length) await sleep(BATCH_DELAY_MS);
    }
  } finally {
    await admin.disconnect();
  }

  console.log(`DELETED_TOPICS=${topics.length}`);
};

run().catch(error => {
  console.error(`STALE_TOPIC_CLEANUP_FAILED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

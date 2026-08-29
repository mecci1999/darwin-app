/*
 * Read-only Kafka consumer-group inventory for production operations.
 * Run this from an existing application container so broker credentials stay
 * inside the container environment.
 */

const { Kafka, logLevel } = require('kafkajs');

const UUID_LIKE_GROUP = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const BATCH_SIZE = 100;

const resolveBrokers = () => {
  const value = String(process.env.KAFKA_BROKERS || process.env.KAFKA_HOST || '').trim();
  const brokers = value
    .split(',')
    .map(broker => broker.trim().replace(/^kafka:\/\//, ''))
    .filter(Boolean);
  if (brokers.length === 0) throw new Error('KAFKA_BROKERS or KAFKA_HOST is required');
  return brokers;
};

const chunks = (values, size) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

const run = async () => {
  const kafka = new Kafka({
    clientId: 'darwin-app-consumer-group-audit',
    brokers: resolveBrokers(),
    logLevel: logLevel.NOTHING,
    retry: { retries: 2, initialRetryTime: 1000, maxRetryTime: 5000 },
  });
  const admin = kafka.admin();
  await admin.connect();

  try {
    const listed = await admin.listGroups();
    const groups = Array.isArray(listed) ? listed : listed.groups || [];
    const byState = {};
    const activeGroups = [];
    let uuidLikeTotal = 0;
    let uuidLikeEmpty = 0;
    let uuidLikeWithMembers = 0;

    for (const batch of chunks(groups.map(group => group.groupId).filter(Boolean), BATCH_SIZE)) {
      const described = await admin.describeGroups(batch);
      const descriptions = Array.isArray(described) ? described : described.groups || [];
      for (const group of descriptions) {
        const state = group.state || 'Unknown';
        const members = Array.isArray(group.members) ? group.members.length : 0;
        byState[state] = (byState[state] || 0) + 1;
        const uuidLike = UUID_LIKE_GROUP.test(group.groupId || '');
        if (uuidLike) {
          uuidLikeTotal += 1;
          if (state === 'Empty' && members === 0) uuidLikeEmpty += 1;
          if (members > 0) uuidLikeWithMembers += 1;
        }
        if (members > 0 || state !== 'Empty') {
          activeGroups.push({ groupId: group.groupId, state, members, protocol: group.protocol || '' });
        }
      }
    }

    console.log(`GROUP_TOTAL=${groups.length}`);
    console.log(`GROUPS_BY_STATE=${JSON.stringify(byState)}`);
    console.log(`UUID_LIKE_TOTAL=${uuidLikeTotal}`);
    console.log(`UUID_LIKE_EMPTY=${uuidLikeEmpty}`);
    console.log(`UUID_LIKE_WITH_MEMBERS=${uuidLikeWithMembers}`);
    console.log(`NON_EMPTY_GROUPS=${activeGroups.length}`);
    console.log(`NON_EMPTY_SAMPLE=${JSON.stringify(activeGroups.slice(0, 80))}`);
  } finally {
    await admin.disconnect();
  }
};

run().catch(error => {
  console.error(`KAFKA_CONSUMER_GROUP_AUDIT_FAILED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

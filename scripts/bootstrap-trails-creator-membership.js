const { QueryTypes } = require('sequelize');
const { createDatabaseConnection } = require('./db');

const MEMBERSHIP_TABLE = 'CreatorSpaceMembership';
const USER_TABLE = 'user';
const allowedRoles = new Set(['creator-space-owner', 'creator-space-editor', 'participant']);

const requiredEnvironment = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optionalEnvironment = name => process.env[name]?.trim() || undefined;

const bootstrapInput = () => {
  const tenantId = requiredEnvironment('TRAILS_CREATOR_BOOTSTRAP_TENANT_ID');
  const userId = requiredEnvironment('TRAILS_CREATOR_BOOTSTRAP_USER_ID');
  const role = requiredEnvironment('TRAILS_CREATOR_BOOTSTRAP_ROLE');
  const assignedOwnerUserId = optionalEnvironment('TRAILS_CREATOR_BOOTSTRAP_ASSIGNED_OWNER_USER_ID');
  const allowOwnerCreate = process.env.TRAILS_CREATOR_BOOTSTRAP_ALLOW_OWNER_CREATE === 'true';

  if (!allowedRoles.has(role)) throw new Error('TRAILS_CREATOR_BOOTSTRAP_ROLE must be creator-space-owner, creator-space-editor, or participant');
  if (role === 'creator-space-editor' && !assignedOwnerUserId) throw new Error('TRAILS_CREATOR_BOOTSTRAP_ASSIGNED_OWNER_USER_ID is required for creator-space-editor');
  if (role !== 'creator-space-editor' && assignedOwnerUserId) throw new Error('TRAILS_CREATOR_BOOTSTRAP_ASSIGNED_OWNER_USER_ID is only allowed for creator-space-editor');
  if (role === 'creator-space-editor' && assignedOwnerUserId === userId) throw new Error('creator-space-editor cannot be assigned to itself');

  return { tenantId, userId, role, assignedOwnerUserId, allowOwnerCreate };
};

const tableExists = (tables, tableName) => tables.some(table => String(table).toLowerCase() === tableName.toLowerCase());

const findActiveTenantUser = async (sequelize, tenantId, userId, label) => {
  const user = await sequelize.query(
    `SELECT user_id AS userId, tenant_id AS tenantId, status FROM \`${USER_TABLE}\` WHERE user_id = ? LIMIT 1`,
    { replacements: [userId], type: QueryTypes.SELECT },
  );
  const record = user[0];
  if (!record || record.status !== 'active' || record.tenantId !== tenantId) {
    throw new Error(`${label} must exist, be active, and belong to TRAILS_CREATOR_BOOTSTRAP_TENANT_ID`);
  }
  return record;
};

const findMembership = async (sequelize, transaction, tenantId, userId) => {
  const rows = await sequelize.query(
    `SELECT tenant_id AS tenantId, user_id AS userId, role, assigned_owner_user_id AS assignedOwnerUserId, status FROM \`${MEMBERSHIP_TABLE}\` WHERE tenant_id = ? AND user_id = ? LIMIT 1`,
    { replacements: [tenantId, userId], type: QueryTypes.SELECT, transaction },
  );
  return rows[0];
};

const ensureOwnerMembership = async (sequelize, transaction, input) => {
  const owner = await findActiveTenantUser(sequelize, input.tenantId, input.assignedOwnerUserId, 'Assigned owner');
  const membership = await findMembership(sequelize, transaction, input.tenantId, owner.userId);
  if (membership && membership.status === 'active' && membership.role === 'creator-space-owner' && !membership.assignedOwnerUserId) return;
  if (membership) throw new Error('Assigned owner must already have an active creator-space-owner membership');
  if (!input.allowOwnerCreate) throw new Error('Assigned owner lacks an active owner membership; set TRAILS_CREATOR_BOOTSTRAP_ALLOW_OWNER_CREATE=true only to create that missing owner membership');

  await sequelize.query(
    `INSERT INTO \`${MEMBERSHIP_TABLE}\` (tenant_id, user_id, role, assigned_owner_user_id, status, created_at, updated_at) VALUES (?, ?, 'creator-space-owner', NULL, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    { replacements: [input.tenantId, owner.userId], transaction },
  );
};

const bootstrapMembership = async (sequelize, input) => {
  const tables = await sequelize.getQueryInterface().showAllTables();
  if (!tableExists(tables, MEMBERSHIP_TABLE)) throw new Error(`${MEMBERSHIP_TABLE} does not exist; run pnpm migrate before bootstrapping Trails access`);
  await findActiveTenantUser(sequelize, input.tenantId, input.userId, 'Target user');

  await sequelize.transaction(async transaction => {
    if (input.role === 'creator-space-editor') await ensureOwnerMembership(sequelize, transaction, input);
    await sequelize.query(
      `INSERT INTO \`${MEMBERSHIP_TABLE}\` (tenant_id, user_id, role, assigned_owner_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE role = VALUES(role), assigned_owner_user_id = VALUES(assigned_owner_user_id), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
      { replacements: [input.tenantId, input.userId, input.role, input.assignedOwnerUserId || null], transaction },
    );
  });
};

const run = async () => {
  const input = bootstrapInput();
  const sequelize = createDatabaseConnection();
  try {
    await sequelize.authenticate();
    await bootstrapMembership(sequelize, input);
    console.log('Creator-space membership bootstrap completed');
  } finally {
    await sequelize.close();
  }
};

if (require.main === module) {
  run().catch(error => {
    console.error(`Creator-space membership bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { MEMBERSHIP_TABLE, bootstrapInput, bootstrapMembership, findActiveTenantUser, run };

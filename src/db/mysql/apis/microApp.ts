import { DataBaseTableNames } from 'typings';
import { mainConnection } from '..';
import { IMicroAppTableAttributes, MicroAppTable } from '../models/microApp';
import { IMicroAppAuditLogTableAttributes, MicroAppAuditLogTable } from '../models/microAppAuditLog';
import { IMicroAppInstallTableAttributes, MicroAppInstallTable } from '../models/microAppInstall';
import {
  IMicroAppVersionTableAttributes,
  MicroAppVersionTable,
  MicroAppVersionStatus,
} from '../models/microAppVersion';

const toJson = <T>(record: { toJSON: () => T } | null): T | null => (record ? record.toJSON() : null);

export async function upsertMicroApp(app: IMicroAppTableAttributes) {
  const model = await mainConnection.getModel<MicroAppTable>(DataBaseTableNames.MicroApp);
  await model.upsert(app as any);
  return findMicroAppByAppId(app.appId);
}

export async function updateMicroAppAccess(
  appId: string,
  access: Pick<IMicroAppTableAttributes, 'visibility' | 'allowedUsers' | 'rolloutUsers'>,
) {
  const model = await mainConnection.getModel<MicroAppTable>(DataBaseTableNames.MicroApp);
  await model.update(access, { where: { appId } });
  return findMicroAppByAppId(appId);
}

export async function updateMicroAppRollout(
  appId: string,
  access: Pick<
    IMicroAppTableAttributes,
    'visibility' | 'allowedUsers' | 'rolloutUsers' | 'rolloutTenants' | 'rolloutPercent' | 'releaseChannel'
  >,
) {
  const model = await mainConnection.getModel<MicroAppTable>(DataBaseTableNames.MicroApp);
  await model.update(access, { where: { appId } });
  return findMicroAppByAppId(appId);
}

export async function findMicroAppByAppId(appId: string): Promise<IMicroAppTableAttributes | null> {
  const model = await mainConnection.getModel<MicroAppTable>(DataBaseTableNames.MicroApp);
  return toJson<IMicroAppTableAttributes>(await model.findOne({ where: { appId } }));
}

export async function listMicroApps(): Promise<IMicroAppTableAttributes[]> {
  const model = await mainConnection.getModel<MicroAppTable>(DataBaseTableNames.MicroApp);
  const records = await model.findAll({ order: [['updatedAt', 'DESC']] });
  return records.map((record) => record.toJSON());
}

export async function upsertMicroAppVersion(version: IMicroAppVersionTableAttributes) {
  const model = await mainConnection.getModel<MicroAppVersionTable>(DataBaseTableNames.MicroAppVersion);
  await model.upsert(version as any);
  return findMicroAppVersion(version.appId, version.version);
}

export async function findMicroAppVersion(
  appId: string,
  version: string,
): Promise<IMicroAppVersionTableAttributes | null> {
  const model = await mainConnection.getModel<MicroAppVersionTable>(DataBaseTableNames.MicroAppVersion);
  return toJson<IMicroAppVersionTableAttributes>(await model.findOne({ where: { appId, version } }));
}

export async function findLatestPublishedVersion(appId: string): Promise<IMicroAppVersionTableAttributes | null> {
  const model = await mainConnection.getModel<MicroAppVersionTable>(DataBaseTableNames.MicroAppVersion);
  return toJson<IMicroAppVersionTableAttributes>(
    await model.findOne({ where: { appId, status: 'published' }, order: [['publishedAt', 'DESC'], ['updatedAt', 'DESC']] }),
  );
}

export async function listMicroAppVersions(appId?: string): Promise<IMicroAppVersionTableAttributes[]> {
  const model = await mainConnection.getModel<MicroAppVersionTable>(DataBaseTableNames.MicroAppVersion);
  const records = await model.findAll({
    where: appId ? { appId } : undefined,
    order: [['updatedAt', 'DESC']],
  });
  return records.map((record) => record.toJSON());
}

export async function updateMicroAppVersionStatus(
  appId: string,
  version: string,
  status: MicroAppVersionStatus,
  patch: Partial<IMicroAppVersionTableAttributes> = {},
) {
  const model = await mainConnection.getModel<MicroAppVersionTable>(DataBaseTableNames.MicroAppVersion);
  await model.update({ ...patch, status }, { where: { appId, version } });
  return findMicroAppVersion(appId, version);
}

export async function createMicroAppAuditLog(log: IMicroAppAuditLogTableAttributes) {
  const model = await mainConnection.getModel<MicroAppAuditLogTable>(DataBaseTableNames.MicroAppAuditLog);
  const record = await model.create(log as any);
  return record.toJSON();
}

export async function listMicroAppAuditLogs(appId?: string): Promise<IMicroAppAuditLogTableAttributes[]> {
  const model = await mainConnection.getModel<MicroAppAuditLogTable>(DataBaseTableNames.MicroAppAuditLog);
  const records = await model.findAll({ where: appId ? { appId } : undefined, order: [['createdAt', 'DESC']] });
  return records.map((record) => record.toJSON());
}

export async function upsertMicroAppInstall(install: IMicroAppInstallTableAttributes) {
  const model = await mainConnection.getModel<MicroAppInstallTable>(DataBaseTableNames.MicroAppInstall);
  const existing = await model.findOne({ where: { userId: install.userId, appId: install.appId } });
  if (existing) {
    await existing.update(install as any);
    return existing.toJSON();
  }
  const record = await model.create(install as any);
  return record.toJSON();
}

export async function listMicroAppInstalls(appId?: string): Promise<IMicroAppInstallTableAttributes[]> {
  const model = await mainConnection.getModel<MicroAppInstallTable>(DataBaseTableNames.MicroAppInstall);
  const records = await model.findAll({ where: appId ? { appId } : undefined, order: [['updatedAt', 'DESC']] });
  return records.map((record) => record.toJSON());
}

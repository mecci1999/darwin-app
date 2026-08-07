import { DataBaseTableNames } from 'typings';
import { mainConnection } from '..';
import { CreatorSpaceMembershipTable, ICreatorSpaceMembershipAttributes } from '../models/creatorSpaceMembership';

export async function findCreatorSpaceMembership(tenantId: string, userId: string): Promise<ICreatorSpaceMembershipAttributes | null> {
  const model = await mainConnection.getModel<CreatorSpaceMembershipTable>(DataBaseTableNames.CreatorSpaceMembership);
  const membership = await model.findOne({ where: { tenantId, userId } });
  return membership ? membership.toJSON() : null;
}

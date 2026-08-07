import { ICreatorSpaceMembershipAttributes } from 'db/mysql/models/creatorSpaceMembership';
import { IUserTableAttributes } from 'db/mysql/models/user';

type MembershipDirectory = {
  findCreatorSpaceMembership(tenantId: string, userId: string): Promise<ICreatorSpaceMembershipAttributes | null>;
};
type UserDirectory = {
  findUserByUserId(userId: string): Promise<IUserTableAttributes | null>;
};

export type ResolvedTrailsActor = {
  tenantId: string;
  user: { userId: string; isAdmin: boolean; power?: number };
  creatorSpaceRole: ICreatorSpaceMembershipAttributes['role'];
  creatorSpaceOwnerUserId?: string;
};

const activeInTenant = (user: IUserTableAttributes | null, tenantId: string): boolean =>
  Boolean(user && user.userId && user.tenantId === tenantId && user.status === 'active');

/** Resolves the only identity shape permitted to cross the micro-app to Trails boundary. */
export async function resolveTrailsWorkspaceActor(
  db: { user: UserDirectory; creatorSpaceMembership: MembershipDirectory },
  userId: string,
): Promise<ResolvedTrailsActor | undefined> {
  const user = await db.user.findUserByUserId(userId);
  if (!user || !user.userId || !user.tenantId || user.status !== 'active') return undefined;

  const membership = await db.creatorSpaceMembership.findCreatorSpaceMembership(user.tenantId, user.userId);
  if (!membership || membership.tenantId !== user.tenantId || membership.userId !== user.userId || membership.status !== 'active') return undefined;

  let creatorSpaceOwnerUserId: string | undefined;
  if (membership.role === 'creator-space-owner') {
    if (membership.assignedOwnerUserId && membership.assignedOwnerUserId !== user.userId) return undefined;
  } else if (membership.role === 'creator-space-editor') {
    if (!membership.assignedOwnerUserId) return undefined;
    const owner = await db.user.findUserByUserId(membership.assignedOwnerUserId);
    if (!owner || !activeInTenant(owner, user.tenantId)) return undefined;
    const ownerMembership = await db.creatorSpaceMembership.findCreatorSpaceMembership(user.tenantId, owner.userId);
    if (!ownerMembership || ownerMembership.status !== 'active' || ownerMembership.role !== 'creator-space-owner') return undefined;
    creatorSpaceOwnerUserId = owner.userId;
  } else if (membership.role !== 'participant' || membership.assignedOwnerUserId) {
    return undefined;
  }

  return {
    tenantId: user.tenantId,
    user: { userId: user.userId, isAdmin: user.power === 999, ...(user.power === undefined ? {} : { power: user.power }) },
    creatorSpaceRole: membership.role,
    ...(creatorSpaceOwnerUserId ? { creatorSpaceOwnerUserId } : {}),
  };
}

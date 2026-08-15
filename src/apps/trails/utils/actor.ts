import { Context } from 'node-universe';
import { Actor, CreatorSpaceRole, TrailsCapabilitySnapshot } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const resolveActor = (ctx: Context): Actor | undefined => {
  const meta: unknown = ctx.meta;
  if (!isRecord(meta) || !isRecord(meta.user)) return undefined;
  const rawUserId = typeof meta.user.userId === 'string' ? meta.user.userId : meta.user.id;
  if (typeof rawUserId !== 'string' || !rawUserId || typeof meta.tenantId !== 'string' || !meta.tenantId) return undefined;
  const roles = Array.isArray(meta.user.roles) ? meta.user.roles : [];
  const creatorSpaceRoleSource = meta.creatorSpaceRole ?? meta.user.creatorSpaceRole;
  const creatorSpaceRole: CreatorSpaceRole | undefined = creatorSpaceRoleSource === 'creator-space-owner' || creatorSpaceRoleSource === 'creator-space-editor' || creatorSpaceRoleSource === 'participant'
    ? creatorSpaceRoleSource
    : undefined;
  const creatorSpaceOwnerSource = meta.creatorSpaceOwnerUserId ?? meta.user.creatorSpaceOwnerUserId;
  const creatorSpaceOwnerUserId = typeof creatorSpaceOwnerSource === 'string' && creatorSpaceOwnerSource ? creatorSpaceOwnerSource : undefined;
  return {
    userId: rawUserId,
    tenantId: meta.tenantId,
    // Darwin's established platform-admin signal remains a coarse override. Creator-space roles
    // are separate and must be populated by trusted server-side membership resolution.
    isAdmin: meta.user.isAdmin === true || meta.user.power === 999 || roles.some((role) => role === 'admin'),
    creatorSpaceRole,
    creatorSpaceOwnerUserId,
  };
};

/** Ownership checks intentionally require only tenant and owner identity, not a specific lifecycle model. */
export const actorCanManage = (actor: Actor, record: Pick<Actor, 'tenantId'> & { ownerUserId: string }): boolean =>
  actor.tenantId === record.tenantId && (actor.isAdmin || actor.userId === record.ownerUserId);

/** Private field records never cross user boundaries, including for coarse platform administrators. */
export const actorCanReadPrivate = (actor: Actor, record: Pick<Actor, 'tenantId'> & { ownerUserId: string }): boolean =>
  actor.tenantId === record.tenantId && actor.userId === record.ownerUserId;

/** Creator records stay tenant/space scoped: ordinary participants cannot manage public content. */
export const actorCanManageCreatorSpace = (actor: Actor, record: Pick<Actor, 'tenantId'> & { ownerUserId: string }): boolean => {
  if (actor.tenantId !== record.tenantId) return false;
  if (actor.isAdmin) return true;
  if (actor.creatorSpaceRole === 'creator-space-owner') return actor.userId === record.ownerUserId;
  return actor.creatorSpaceRole === 'creator-space-editor' && actor.creatorSpaceOwnerUserId === record.ownerUserId;
};

/** The server-selected space target for new/listed creator content; never sourced from action params. */
export const creatorSpaceOwnerId = (actor: Actor): string | undefined => {
  if (actor.isAdmin || actor.creatorSpaceRole === 'creator-space-owner') return actor.userId;
  return actor.creatorSpaceRole === 'creator-space-editor' ? actor.creatorSpaceOwnerUserId : undefined;
};

/** Every authenticated actor receives private field-tool UX capability; server actions still scope records by actor. */
export const capabilitySnapshot = (actor: Actor): TrailsCapabilitySnapshot => {
  const creatorContent = actor.isAdmin || actor.creatorSpaceRole === 'creator-space-owner' || actor.creatorSpaceRole === 'creator-space-editor';
  return { privateFieldTools: true, creatorContent, creatorTrips: creatorContent, creatorSpaceRole: actor.creatorSpaceRole ?? 'participant' };
};

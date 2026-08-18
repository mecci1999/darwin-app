import { processTrustedJpegDerivatives } from './trusted-jpeg-processor';
import { importTrustedPhotoshopPublicationPackage, TrustedPhotoshopPublicationPackageEntry } from './trusted-photoshop-publication-package-importer';
import { stageTrustedPhotoshopPackageDerivatives } from './trusted-photoshop-derivative-staging-plan';
import { TrustedPhotoshopIngestionOperationStore } from '../repository/trustedPhotoshopIngestionOperationStore';
import { TrustedPhotoshopIngestionOperation } from '../repository/mysqlTrustedPhotoshopIngestionOperation';
import { TrustedPhotoshopIngestionPrivateStorage } from './trusted-photoshop-ingestion-private-storage';
import { Actor, DurableMediaAsset, DurableMediaAssetArtifactDescriptor, DurableMediaAssetRegistryStore } from '../types';
import { TrailsPublicDerivativePublicationJobStore } from '../repository/mysqlPublicDerivativePublicationJob';
import { createHash } from 'crypto';

export interface TrustedPhotoshopPublicationIngestionSummary { operationId: string; assetId: string; phase: 'completed'; assetStatus: 'draft'; }
export class TrustedPhotoshopPublicationIngestionCoordinatorError extends Error {
  constructor(readonly stage: 'validation' | 'storage' | 'registry-master' | 'registry-artifacts' | 'publication') { super('Trusted Photoshop publication ingestion failed'); this.name = 'TrustedPhotoshopPublicationIngestionCoordinatorError'; }
}

export interface TrustedPhotoshopPublicationIngestionInput {
  actor: Actor;
  operationId: string;
  ownerUserId: string;
  assetId: string;
  workerId: string;
  leaseMs: number;
  entries: readonly TrustedPhotoshopPublicationPackageEntry[];
}

const summary = (operation: TrustedPhotoshopIngestionOperation): TrustedPhotoshopPublicationIngestionSummary => ({ operationId: operation.operationId, assetId: operation.assetId, phase: 'completed', assetStatus: 'draft' });
const validAsset = (asset: unknown, operation: TrustedPhotoshopIngestionOperation): asset is DurableMediaAsset => typeof asset === 'object' && asset !== null && (asset as DurableMediaAsset).id === operation.assetId && (asset as DurableMediaAsset).tenantId === operation.tenantId && (asset as DurableMediaAsset).ownerUserId === operation.ownerUserId && (asset as DurableMediaAsset).status === 'draft' && typeof (asset as DurableMediaAsset).resourceVersion === 'string';
const effectiveOwner = (actor: Actor): string | undefined => actor.creatorSpaceRole === 'creator-space-owner' ? actor.userId : actor.creatorSpaceRole === 'creator-space-editor' ? actor.creatorSpaceOwnerUserId : undefined;
const coordinatorError = (operation: TrustedPhotoshopIngestionOperation | undefined): TrustedPhotoshopPublicationIngestionCoordinatorError => new TrustedPhotoshopPublicationIngestionCoordinatorError(
  operation?.phase === 'prepared' ? 'validation'
    : operation?.phase === 'storage_pending' ? 'storage'
      : operation?.phase === 'registry_master_pending' ? 'registry-master'
        : operation?.phase === 'registry_artifacts_pending' ? 'registry-artifacts'
          : operation?.phase === 'completed' ? 'publication' : 'validation',
);
const opaqueLocator = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);

/** Server-only worker seam with no public projection, cleanup, or retry responsibility. */
export const ingestTrustedPhotoshopPublication = async (
  input: TrustedPhotoshopPublicationIngestionInput,
  operations: TrustedPhotoshopIngestionOperationStore,
  storage: TrustedPhotoshopIngestionPrivateStorage,
  registry: DurableMediaAssetRegistryStore,
  publicationJobs?: TrailsPublicDerivativePublicationJobStore,
): Promise<TrustedPhotoshopPublicationIngestionSummary> => {
  let operation: TrustedPhotoshopIngestionOperation | undefined;
  let externalCallOutstanding = false;
  try {
    if (effectiveOwner(input.actor) !== input.ownerUserId || input.actor.tenantId.length === 0) throw new Error('invalid effective owner');
    const imported = await importTrustedPhotoshopPublicationPackage(input.entries);
    const preview = imported.jpegs.find(item => item.logicalRendition === 'preview-4096');
    if (!preview) throw new Error('verified preview missing');
    const derivatives = await processTrustedJpegDerivatives(preview.buffer);
    const plan = stageTrustedPhotoshopPackageDerivatives({ claims: { schema: imported.claims.schema }, source: { logicalRendition: 'preview-4096', width: preview.width, height: preview.height, byteLength: preview.byteLength, sha256: preview.sha256 }, derivatives });
    operation = await operations.create({ tenantId: input.actor.tenantId, operationId: input.operationId, ownerUserId: input.ownerUserId, assetId: input.assetId, assetFingerprint: preview.sha256, registerMutationId: `${input.operationId}:register`, artifactMutationId: `${input.operationId}:artifacts`, master: { mimeType: 'image/jpeg', byteLength: preview.byteLength, sha256: preview.sha256 }, artifacts: plan.artifacts.map(({ logicalRendition, codec, mime, width, height, byteLength, sha256 }) => ({ logicalRendition, codec, mimeType: mime, width, height, byteLength, sha256 })) });
    if (operation.phase === 'completed') return summary(operation);
    operation = await operations.claim({ tenantId: input.actor.tenantId, operationId: input.operationId, owner: input.workerId, leaseMs: input.leaseMs });
    if (operation.phase === 'prepared') operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'storage_pending' });
    if (operation.phase === 'storage_pending') {
      if (!operation.master.locator) {
        const grant = await operations.acquireStorageWriteFence({ tenantId: operation.tenantId, operationId: operation.operationId, slot: 'master', leaseOwner: input.workerId, expectedVersion: operation.resourceVersion });
        operation = { ...operation, resourceVersion: grant.resourceVersion };
        externalCallOutstanding = true;
        const result = await storage.storeMaster({ tenantId: operation.tenantId, operationId: operation.operationId, grant, content: preview.buffer, mimeType: 'image/jpeg', byteLength: preview.byteLength, sha256: preview.sha256 });
        if (!result || !opaqueLocator(result.privateLocator)) throw new Error('invalid storage result');
        operation = await operations.recordMaster({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: grant.resourceVersion, fenceToken: grant.fenceToken, locator: result.privateLocator, mimeType: 'image/jpeg', byteLength: preview.byteLength, sha256: preview.sha256 });
        externalCallOutstanding = false;
      }
      for (const artifact of plan.artifacts) {
        if (operation.artifacts.some(item => item.logicalRendition === artifact.logicalRendition && item.codec === artifact.codec && item.locator)) continue;
        const grant = await operations.acquireStorageWriteFence({ tenantId: operation.tenantId, operationId: operation.operationId, slot: artifact.slot, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion });
        operation = { ...operation, resourceVersion: grant.resourceVersion };
        externalCallOutstanding = true;
        const result = await storage.storeArtifact({ tenantId: operation.tenantId, operationId: operation.operationId, slot: artifact.slot, grant, artifact });
        if (!result || !opaqueLocator(result.privateLocator)) throw new Error('invalid storage result');
        operation = await operations.recordArtifact({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: grant.resourceVersion, fenceToken: grant.fenceToken, logicalRendition: artifact.logicalRendition, codec: artifact.codec, locator: result.privateLocator, mimeType: artifact.mime, width: artifact.width, height: artifact.height, byteLength: artifact.byteLength, sha256: artifact.sha256 });
        externalCallOutstanding = false;
      }
      operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'storage_recorded' });
    }
    if (operation.phase === 'storage_recorded') operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'registry_master_pending' });
    if (operation.phase === 'registry_master_pending') {
      externalCallOutstanding = true;
      const masterResult = await registry.register(input.actor, { mutationId: operation.registerMutationId, expectedResourceVersion: null, id: operation.assetId, mimeType: operation.master.mimeType, privateMasterLocator: operation.master.locator! });
      if (!validAsset(masterResult, operation)) throw new Error('invalid registry master result');
      operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'registry_master_recorded', registryMasterVersion: masterResult.resourceVersion });
      externalCallOutstanding = false;
    }
    if (operation.phase === 'registry_master_recorded') operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'registry_artifacts_pending' });
    if (operation.phase === 'registry_artifacts_pending') {
      const artifacts: DurableMediaAssetArtifactDescriptor[] = operation.artifacts.map(item => {
        if (!item.locator) throw new Error('recorded artifact missing');
        return { logicalRendition: item.logicalRendition, codec: item.codec, privateLocator: item.locator, mimeType: item.mimeType, width: item.width, height: item.height, byteLength: Number(item.byteLength), sha256: item.sha256 };
      });
      externalCallOutstanding = true;
      const artifactResult = await registry.persistArtifacts(input.actor, { mutationId: operation.artifactMutationId, expectedResourceVersion: operation.registryMasterVersion!, assetId: operation.assetId, artifacts });
      if (!validAsset(artifactResult, operation)) throw new Error('invalid registry artifacts result');
      if (publicationJobs) {
        const approvalId = `approval_${createHash('sha256').update(`${operation.tenantId}\u0000${operation.operationId}\u0000${artifactResult.resourceVersion}`).digest('base64url')}`;
        await publicationJobs.enqueue({ tenantId: operation.tenantId, operationId: operation.operationId, actor: input.actor, assetId: operation.assetId, expectedResourceVersion: artifactResult.resourceVersion, approvalId });
      }
      operation = await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'completed', registryArtifactsVersion: artifactResult.resourceVersion });
      externalCallOutstanding = false;
    }
    if (operation.phase === 'completed') return summary(operation);
    throw new Error('operation cannot continue');
  } catch (_error: unknown) {
    if (operation && operation.phase === 'prepared' && !externalCallOutstanding) {
      try { await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'failed', failureClass: 'validation' }); } catch (_ignored: unknown) { /* redacted */ }
    } else if (operation && externalCallOutstanding && ['storage_pending', 'registry_master_pending', 'registry_artifacts_pending'].includes(operation.phase)) {
      try { await operations.transition({ tenantId: operation.tenantId, operationId: operation.operationId, leaseOwner: input.workerId, expectedVersion: operation.resourceVersion, phase: 'blocked_ambiguous', failureClass: operation.phase === 'storage_pending' ? 'storage' : 'registry' }); } catch (_ignored: unknown) { /* redacted */ }
    }
    throw coordinatorError(operation);
  }
};

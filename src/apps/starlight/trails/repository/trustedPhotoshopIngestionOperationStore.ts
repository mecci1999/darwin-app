import {
  TrustedPhotoshopArtifactDescriptor,
  TrustedPhotoshopIngestionFailureClass,
  TrustedPhotoshopIngestionOperation,
  TrustedPhotoshopIngestionPhase,
  TrustedPhotoshopStorageWriteFenceGrant,
  TrustedPhotoshopStorageWriteFenceSlot,
} from './mysqlTrustedPhotoshopIngestionOperation';

/** Coordinator-facing durable operation boundary. It intentionally excludes Sequelize details. */
export interface TrustedPhotoshopIngestionOperationStore {
  create(input: {
    tenantId: string;
    operationId: string;
    ownerUserId: string;
    assetId: string;
    assetFingerprint: string;
    registerMutationId: string;
    artifactMutationId: string;
    master: { mimeType: string; byteLength: number; sha256: string };
    artifacts: readonly TrustedPhotoshopArtifactDescriptor[];
  }): Promise<TrustedPhotoshopIngestionOperation>;
  claim(input: { tenantId: string; operationId: string; owner: string; leaseMs: number }): Promise<TrustedPhotoshopIngestionOperation>;
  acquireStorageWriteFence(input: { tenantId: string; operationId: string; slot: TrustedPhotoshopStorageWriteFenceSlot; leaseOwner: string; expectedVersion: string }): Promise<TrustedPhotoshopStorageWriteFenceGrant>;
  transition(input: {
    tenantId: string;
    operationId: string;
    leaseOwner: string;
    expectedVersion: string;
    phase: TrustedPhotoshopIngestionPhase;
    failureClass?: TrustedPhotoshopIngestionFailureClass;
    registryMasterVersion?: string;
    registryArtifactsVersion?: string;
  }): Promise<TrustedPhotoshopIngestionOperation>;
  recordMaster(input: {
    tenantId: string;
    operationId: string;
    leaseOwner: string;
    expectedVersion: string;
    fenceToken: string;
    locator: string;
    mimeType: string;
    byteLength: number;
    sha256: string;
  }): Promise<TrustedPhotoshopIngestionOperation>;
  recordArtifact(input: {
    tenantId: string;
    operationId: string;
    leaseOwner: string;
    expectedVersion: string;
    fenceToken: string;
    logicalRendition: TrustedPhotoshopArtifactDescriptor['logicalRendition'];
    codec: TrustedPhotoshopArtifactDescriptor['codec'];
    locator: string;
    mimeType: TrustedPhotoshopArtifactDescriptor['mimeType'];
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
  }): Promise<TrustedPhotoshopIngestionOperation>;
}

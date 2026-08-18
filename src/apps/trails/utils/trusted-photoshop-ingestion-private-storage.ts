import { createHash } from 'crypto';
import { TrustedPhotoshopDerivativeStagedArtifact } from './trusted-photoshop-derivative-staging-plan';

export interface TrustedPhotoshopIngestionPrivateStorage {
  storeMaster(input: { tenantId: string; operationId: string; grant: { objectIdentity: string; fenceToken: string; intentDigest: string }; content: Buffer; mimeType: 'image/jpeg'; byteLength: number; sha256: string }): Promise<{ privateLocator: string }>;
  storeArtifact(input: { tenantId: string; operationId: string; slot: TrustedPhotoshopDerivativeStagedArtifact['slot']; grant: { objectIdentity: string; fenceToken: string; intentDigest: string }; artifact: TrustedPhotoshopDerivativeStagedArtifact }): Promise<{ privateLocator: string }>;
}

type Stored = { digest: string; buffer: Buffer; privateLocator: string };

const opaqueLocator = (identity: string): string => `ingestion_${createHash('sha256').update(identity).digest('hex')}`;
const contentDigest = (buffer: Buffer, metadata: unknown): string => createHash('sha256').update(JSON.stringify(metadata)).update(buffer).digest('hex');
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

/** Hermetic coordinator fake. Inspection helpers are intentionally absent from its production contract. */
export class InMemoryTrustedPhotoshopIngestionPrivateStorage implements TrustedPhotoshopIngestionPrivateStorage {
  private readonly entries = new Map<string, Stored>();

  private store(identity: string, content: Buffer, metadata: { mimeType: string; byteLength: number; sha256: string }): { privateLocator: string } {
    if (!Buffer.isBuffer(content) || content.length !== metadata.byteLength || !validHash(metadata.sha256) || createHash('sha256').update(content).digest('hex') !== metadata.sha256) throw new Error('invalid private ingestion content');
    const digest = contentDigest(content, metadata);
    const prior = this.entries.get(identity);
    if (prior) {
      if (prior.digest !== digest) throw new Error('private ingestion identity collision');
      return { privateLocator: prior.privateLocator };
    }
    const privateLocator = opaqueLocator(identity);
    this.entries.set(identity, { digest, buffer: Buffer.from(content), privateLocator });
    return { privateLocator };
  }

  async storeMaster(input: { tenantId: string; operationId: string; grant: { objectIdentity: string; fenceToken: string; intentDigest: string }; content: Buffer; mimeType: 'image/jpeg'; byteLength: number; sha256: string }): Promise<{ privateLocator: string }> {
    return this.store(input.grant.objectIdentity, input.content, { mimeType: input.mimeType, byteLength: input.byteLength, sha256: input.sha256 });
  }

  async storeArtifact(input: { tenantId: string; operationId: string; slot: TrustedPhotoshopDerivativeStagedArtifact['slot']; grant: { objectIdentity: string; fenceToken: string; intentDigest: string }; artifact: TrustedPhotoshopDerivativeStagedArtifact }): Promise<{ privateLocator: string }> {
    const { artifact } = input;
    if (artifact.slot !== input.slot) throw new Error('private ingestion slot mismatch');
    return this.store(input.grant.objectIdentity, artifact.buffer, { mimeType: artifact.mime, byteLength: artifact.byteLength, sha256: artifact.sha256 });
  }

  bufferCopyForTest(objectIdentity: string): Buffer | undefined {
    const buffer = this.entries.get(objectIdentity)?.buffer;
    return buffer === undefined ? undefined : Buffer.from(buffer);
  }

  countForTest(): number { return this.entries.size; }
}

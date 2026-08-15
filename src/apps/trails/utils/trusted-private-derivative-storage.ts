import { TrustedPhotoshopDerivativeStagedArtifact } from './trusted-photoshop-derivative-staging-plan';

/**
 * The only Trails boundary permitted to receive private derivative bytes.
 * Implementations issue and retain opaque locators; they never return delivery data.
 * Successful results must be returned in the exact input artifact order because mapping is positional.
 */
export interface TrustedPrivateDerivativeStorage {
  store(artifacts: readonly TrustedPhotoshopDerivativeStagedArtifact[]): Promise<readonly TrustedPrivateDerivativeStorageResult[]>;
  remove(locators: readonly string[]): Promise<void>;
}

/** Deliberately locator-only: backend metadata, paths, links, and buffers are forbidden. */
export interface TrustedPrivateDerivativeStorageResult {
  privateLocator: string;
}

export class InMemoryTrustedPrivateDerivativeStorage implements TrustedPrivateDerivativeStorage {
  private readonly entries = new Map<string, Buffer>();
  private nextLocator = 1;

  constructor(private readonly failAfterStoredArtifacts: number | undefined = undefined) {}

  async store(artifacts: readonly TrustedPhotoshopDerivativeStagedArtifact[]): Promise<readonly TrustedPrivateDerivativeStorageResult[]> {
    const created: string[] = [];
    try {
      for (const artifact of artifacts) {
        if (this.failAfterStoredArtifacts !== undefined && created.length === this.failAfterStoredArtifacts) throw new Error('private derivative storage failed');
        const privateLocator = `trusted_private_derivative_${this.nextLocator.toString().padStart(8, '0')}`;
        this.nextLocator += 1;
        this.entries.set(privateLocator, Buffer.from(artifact.buffer));
        created.push(privateLocator);
      }
      return created.map(privateLocator => ({ privateLocator }));
    } catch (error: unknown) {
      for (const privateLocator of created) this.entries.delete(privateLocator);
      throw error;
    }
  }

  async remove(locators: readonly string[]): Promise<void> {
    for (const privateLocator of locators) this.entries.delete(privateLocator);
  }

  /** Test support only; returns a defensive copy and never belongs to the storage contract. */
  bufferCopyForTest(privateLocator: string): Buffer | undefined {
    const buffer = this.entries.get(privateLocator);
    return buffer === undefined ? undefined : Buffer.from(buffer);
  }

  countForTest(): number {
    return this.entries.size;
  }
}

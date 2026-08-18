import { createHash } from 'crypto';
import {
  Actor,
  DurableCommerceMutation,
  DurableMediaAsset,
  DurableMediaAssetArtifactDescriptor,
  DurableMediaAssetRegistryStore,
} from '../types';
import {
  TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT,
  TrustedPhotoshopDerivativeStagingPlan,
} from './trusted-photoshop-derivative-staging-plan';
import { TrustedPrivateDerivativeStorage, TrustedPrivateDerivativeStorageResult } from './trusted-private-derivative-storage';

const artifactMatrix = [
  { logicalRendition: 'grid-960', codec: 'avif', mimeType: 'image/avif', target: 960 },
  { logicalRendition: 'grid-960', codec: 'webp', mimeType: 'image/webp', target: 960 },
  { logicalRendition: 'grid-960', codec: 'jpeg', mimeType: 'image/jpeg', target: 960 },
  { logicalRendition: 'cover-2048', codec: 'avif', mimeType: 'image/avif', target: 2048 },
  { logicalRendition: 'cover-2048', codec: 'webp', mimeType: 'image/webp', target: 2048 },
  { logicalRendition: 'cover-2048', codec: 'jpeg', mimeType: 'image/jpeg', target: 2048 },
  { logicalRendition: 'preview-4096', codec: 'avif', mimeType: 'image/avif', target: 4096 },
  { logicalRendition: 'preview-4096', codec: 'webp', mimeType: 'image/webp', target: 4096 },
  { logicalRendition: 'preview-4096', codec: 'jpeg', mimeType: 'image/jpeg', target: 4096 },
] as const;

const opaqueLocator = /^[A-Za-z0-9_-]{1,512}$/;
const positiveSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const expectedDimensions = (source: TrustedPhotoshopDerivativeStagingPlan['source'], target: number) => {
  const scale = Math.min(target / Math.max(source.width, source.height), 1);
  return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) };
};

export interface TrustedPhotoshopDerivativePersistenceInput {
  actor: Actor;
  mutation: DurableCommerceMutation & { assetId: string };
  plan: TrustedPhotoshopDerivativeStagingPlan;
}

/** Redacted failure across separate storage and registry atomic domains. */
export class TrustedPhotoshopDerivativePersistenceError extends Error {
  constructor() {
    super('Trusted Photoshop derivative persistence failed');
    this.name = 'TrustedPhotoshopDerivativePersistenceError';
  }
}

const validatePlan = (plan: TrustedPhotoshopDerivativeStagingPlan): void => {
  if (
    plan.contract !== TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT
    || plan.source.logicalRendition !== 'preview-4096'
    || !positiveSafeInteger(plan.source.width)
    || !positiveSafeInteger(plan.source.height)
    || !positiveSafeInteger(plan.source.byteLength)
    || !/^[a-f0-9]{64}$/.test(plan.source.sha256)
    || plan.artifacts.length !== artifactMatrix.length
  ) throw new Error('Invalid staging plan');
  for (const [index, expected] of artifactMatrix.entries()) {
    const artifact = plan.artifacts[index];
    const dimensions = expectedDimensions(plan.source, expected.target);
    if (
      artifact === undefined
      || artifact.slot !== `${expected.logicalRendition}:${expected.codec}`
      || artifact.logicalRendition !== expected.logicalRendition
      || artifact.codec !== expected.codec
      || artifact.mime !== expected.mimeType
      || !Buffer.isBuffer(artifact.buffer)
      || artifact.buffer.length === 0
      || !positiveSafeInteger(artifact.width)
      || !positiveSafeInteger(artifact.height)
      || !positiveSafeInteger(artifact.byteLength)
      || artifact.width !== dimensions.width
      || artifact.height !== dimensions.height
      || artifact.byteLength !== artifact.buffer.length
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || artifact.sha256 !== createHash('sha256').update(artifact.buffer).digest('hex')
    ) throw new Error('Invalid staging artifact');
  }
};

const locatorsForCleanup = (results: unknown): string[] => Array.isArray(results)
  ? results.flatMap(result => typeof result === 'object' && result !== null && typeof (result as Record<string, unknown>).privateLocator === 'string'
    ? [(result as Record<string, unknown>).privateLocator as string]
    : [])
  : [];

const validateStorageResults = (results: unknown): readonly TrustedPrivateDerivativeStorageResult[] => {
  if (!Array.isArray(results) || results.length !== artifactMatrix.length) throw new Error('Invalid private storage results');
  const locators = results.map(result => {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Invalid private storage result');
    const fields = Object.keys(result);
    const privateLocator = (result as Record<string, unknown>).privateLocator;
    if (fields.length !== 1 || fields[0] !== 'privateLocator' || typeof privateLocator !== 'string' || !opaqueLocator.test(privateLocator)) throw new Error('Invalid private storage result');
    return privateLocator;
  });
  if (new Set(locators).size !== locators.length) throw new Error('Duplicate private storage locator');
  return results as TrustedPrivateDerivativeStorageResult[];
};

const descriptors = (plan: TrustedPhotoshopDerivativeStagingPlan, results: readonly TrustedPrivateDerivativeStorageResult[]): readonly DurableMediaAssetArtifactDescriptor[] => plan.artifacts.map((artifact, index) => ({
  logicalRendition: artifact.logicalRendition,
  codec: artifact.codec,
  privateLocator: results[index].privateLocator,
  mimeType: artifact.mime,
  width: artifact.width,
  height: artifact.height,
  byteLength: artifact.byteLength,
  sha256: artifact.sha256,
}));

/**
 * Persists a validated staging plan across two non-transactional domains. It never retries the combined operation.
 */
export const persistTrustedPhotoshopDerivativeStagingPlan = async (
  input: TrustedPhotoshopDerivativePersistenceInput,
  storage: TrustedPrivateDerivativeStorage,
  registry: DurableMediaAssetRegistryStore,
): Promise<DurableMediaAsset> => {
  let storageResults: unknown;
  try {
    validatePlan(input.plan);
    storageResults = await storage.store(input.plan.artifacts);
    const validatedStorageResults = validateStorageResults(storageResults);
    return await registry.persistArtifacts(input.actor, {
      mutationId: input.mutation.mutationId,
      expectedResourceVersion: input.mutation.expectedResourceVersion,
      assetId: input.mutation.assetId,
      artifacts: descriptors(input.plan, validatedStorageResults),
    });
  } catch (error: unknown) {
    const locators = locatorsForCleanup(storageResults);
    if (locators.length > 0) {
      try {
        await storage.remove(locators);
      } catch (_cleanupError: unknown) {
        // Cleanup is best effort; its private details never replace the redacted failure.
      }
    }
    throw new TrustedPhotoshopDerivativePersistenceError();
  }
};

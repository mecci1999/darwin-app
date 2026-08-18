import { createHash } from 'crypto';
import {
  TrustedPhotoshopPackageDerivativeClaims,
  TrustedPhotoshopPackageDerivativeSource,
  TrustedPhotoshopPackageDerivatives,
} from './trusted-photoshop-package-derivative-orchestrator';
import {
  TrustedJpegDerivativeFormat,
  TrustedJpegRenditionName,
} from './trusted-jpeg-processor';

export const TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT = 'trusted-photoshop-derivative-staging-plan/v1' as const;

type TrustedPhotoshopDerivativeMime = 'image/avif' | 'image/webp' | 'image/jpeg';

export interface TrustedPhotoshopDerivativeStagedArtifact {
  slot: `${TrustedJpegRenditionName}:${TrustedJpegDerivativeFormat}`;
  logicalRendition: TrustedJpegRenditionName;
  codec: TrustedJpegDerivativeFormat;
  mime: TrustedPhotoshopDerivativeMime;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  buffer: Buffer;
}

/** Server-private, pre-storage data. This value must not be serialized, logged, or returned by an action. */
export interface TrustedPhotoshopDerivativeStagingPlan {
  contract: typeof TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT;
  claims: TrustedPhotoshopPackageDerivativeClaims;
  source: TrustedPhotoshopPackageDerivativeSource;
  artifacts: readonly TrustedPhotoshopDerivativeStagedArtifact[];
}

/** A redacted boundary error; no derivative, source, or validation detail leaves this module. */
export class TrustedPhotoshopDerivativeStagingPlanError extends Error {
  constructor() {
    super('Trusted Photoshop derivative staging plan failed');
    this.name = 'TrustedPhotoshopDerivativeStagingPlanError';
  }
}

const EXPECTED_ARTIFACTS = [
  { rendition: 'grid-960', codec: 'avif', mime: 'image/avif', target: 960 },
  { rendition: 'grid-960', codec: 'webp', mime: 'image/webp', target: 960 },
  { rendition: 'grid-960', codec: 'jpeg', mime: 'image/jpeg', target: 960 },
  { rendition: 'cover-2048', codec: 'avif', mime: 'image/avif', target: 2048 },
  { rendition: 'cover-2048', codec: 'webp', mime: 'image/webp', target: 2048 },
  { rendition: 'cover-2048', codec: 'jpeg', mime: 'image/jpeg', target: 2048 },
  { rendition: 'preview-4096', codec: 'avif', mime: 'image/avif', target: 4096 },
  { rendition: 'preview-4096', codec: 'webp', mime: 'image/webp', target: 4096 },
  { rendition: 'preview-4096', codec: 'jpeg', mime: 'image/jpeg', target: 4096 },
] as const;

const isPositiveSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const expectedDimensions = (source: TrustedPhotoshopPackageDerivativeSource, target: number) => {
  const scale = Math.min(target / Math.max(source.width, source.height), 1);
  return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) };
};

const projectClaims = (claims: TrustedPhotoshopPackageDerivativeClaims): TrustedPhotoshopPackageDerivativeClaims => ({
  schema: claims.schema,
  ...(claims.packageId === undefined ? {} : { packageId: claims.packageId }),
  ...(claims.createdAt === undefined ? {} : { createdAt: claims.createdAt }),
  ...(claims.producer === undefined ? {} : { producer: claims.producer }),
});

const projectSource = (source: TrustedPhotoshopPackageDerivativeSource): TrustedPhotoshopPackageDerivativeSource => ({
  logicalRendition: 'preview-4096',
  width: source.width,
  height: source.height,
  byteLength: source.byteLength,
  sha256: source.sha256,
});

/**
 * Converts the trusted derivative orchestrator result into a server-private staging plan.
 * It is intentionally pre-storage, unregistered, unpublished, and contains no action response.
 */
export const stageTrustedPhotoshopPackageDerivatives = (
  derivatives: TrustedPhotoshopPackageDerivatives,
): TrustedPhotoshopDerivativeStagingPlan => {
  try {
    const { source } = derivatives;
    if (
      source.logicalRendition !== 'preview-4096'
      || !isPositiveSafeInteger(source.width)
      || !isPositiveSafeInteger(source.height)
      || !isPositiveSafeInteger(source.byteLength)
      || !/^[a-f0-9]{64}$/.test(source.sha256)
      || derivatives.derivatives.length !== EXPECTED_ARTIFACTS.length
    ) throw new Error('Invalid trusted derivative source');

    const artifacts = EXPECTED_ARTIFACTS.map((expected, index): TrustedPhotoshopDerivativeStagedArtifact => {
      const derivative = derivatives.derivatives[index];
      const dimensions = expectedDimensions(source, expected.target);
      const sha256 = Buffer.isBuffer(derivative.buffer)
        ? createHash('sha256').update(derivative.buffer).digest('hex')
        : '';
      if (
        derivative.name !== expected.rendition
        || derivative.format !== expected.codec
        || derivative.mime !== expected.mime
        || !Buffer.isBuffer(derivative.buffer)
        || derivative.buffer.length === 0
        || !isPositiveSafeInteger(derivative.width)
        || !isPositiveSafeInteger(derivative.height)
        || !isPositiveSafeInteger(derivative.byteLength)
        || derivative.byteLength !== derivative.buffer.length
        || derivative.width !== dimensions.width
        || derivative.height !== dimensions.height
        || !/^[a-f0-9]{64}$/.test(derivative.sha256)
        || derivative.sha256 !== sha256
      ) throw new Error('Invalid trusted derivative artifact');

      return {
        slot: `${expected.rendition}:${expected.codec}`,
        logicalRendition: expected.rendition,
        codec: expected.codec,
        mime: expected.mime,
        width: derivative.width,
        height: derivative.height,
        byteLength: derivative.byteLength,
        sha256,
        buffer: derivative.buffer,
      };
    });

    return {
      contract: TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT,
      claims: projectClaims(derivatives.claims),
      source: projectSource(source),
      artifacts,
    };
  } catch (error: unknown) {
    if (error instanceof TrustedPhotoshopDerivativeStagingPlanError) throw error;
    throw new TrustedPhotoshopDerivativeStagingPlanError();
  }
};

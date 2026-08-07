import {
  importTrustedPhotoshopPublicationPackage,
  TrustedPhotoshopPublicationPackageClaims,
  TrustedPhotoshopPublicationPackageEntry,
} from './trusted-photoshop-publication-package-importer';
import {
  processTrustedJpegDerivatives,
  TrustedJpegDerivative,
} from './trusted-jpeg-processor';

export interface TrustedPhotoshopPackageDerivativeClaims {
  schema: TrustedPhotoshopPublicationPackageClaims['schema'];
  packageId?: string;
  createdAt?: string;
  producer?: TrustedPhotoshopPublicationPackageClaims['producer'];
}

/** Facts established by the importer for the one buffer provided to the processor. */
export interface TrustedPhotoshopPackageDerivativeSource {
  logicalRendition: 'preview-2048';
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export interface TrustedPhotoshopPackageDerivatives {
  claims: TrustedPhotoshopPackageDerivativeClaims;
  source: TrustedPhotoshopPackageDerivativeSource;
  derivatives: TrustedJpegDerivative[];
}

/** A redacted boundary error; importer, selection, and encoder details never leave this module. */
export class TrustedPhotoshopPackageDerivativeOrchestrationError extends Error {
  constructor() {
    super('Trusted Photoshop package derivative processing failed');
    this.name = 'TrustedPhotoshopPackageDerivativeOrchestrationError';
  }
}

const projectClaims = (claims: TrustedPhotoshopPublicationPackageClaims): TrustedPhotoshopPackageDerivativeClaims => ({
  schema: claims.schema,
  ...(claims.packageId === undefined ? {} : { packageId: claims.packageId }),
  ...(claims.createdAt === undefined ? {} : { createdAt: claims.createdAt }),
  ...(claims.producer === undefined ? {} : { producer: claims.producer }),
});

/**
 * Composes the strict in-memory package importer with the trusted JPEG processor.
 * It processes only the server-verified preview rendition and has no storage or publication role.
 */
export const processTrustedPhotoshopPackageDerivatives = async (
  entries: readonly TrustedPhotoshopPublicationPackageEntry[],
): Promise<TrustedPhotoshopPackageDerivatives> => {
  try {
    const imported = await importTrustedPhotoshopPublicationPackage(entries);
    const preview = imported.jpegs.find(({ logicalRendition }) => logicalRendition === 'preview-2048');
    if (preview === undefined) throw new Error('Verified preview rendition missing');

    const derivatives = await processTrustedJpegDerivatives(preview.buffer);
    return {
      claims: projectClaims(imported.claims),
      source: {
        logicalRendition: 'preview-2048',
        width: preview.width,
        height: preview.height,
        byteLength: preview.byteLength,
        sha256: preview.sha256,
      },
      derivatives,
    };
  } catch (error: unknown) {
    if (error instanceof TrustedPhotoshopPackageDerivativeOrchestrationError) throw error;
    throw new TrustedPhotoshopPackageDerivativeOrchestrationError();
  }
};

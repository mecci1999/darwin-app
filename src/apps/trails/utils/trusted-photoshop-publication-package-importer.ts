import { createHash } from 'crypto';
import sharp from 'sharp';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INPUT_PIXELS = 64_000_000;
const MAX_INPUT_CHANNELS = 4;

const EXPECTED_RENDITIONS = [
  { logicalRendition: 'grid-960', entryName: 'website/grid-960.v1.jpg', filename: 'grid-960.v1.jpg', presetId: 'website-grid-960', longestEdge: 960 },
  { logicalRendition: 'cover-2048', entryName: 'website/cover-2048.v1.jpg', filename: 'cover-2048.v1.jpg', presetId: 'website-cover-2048', longestEdge: 2048 },
  { logicalRendition: 'preview-4096', entryName: 'website/preview-4096.v1.jpg', filename: 'preview-4096.v1.jpg', presetId: 'website-preview-4096', longestEdge: 4096 },
] as const;

const EXPECTED_ENTRY_NAMES = ['manifest.json', ...EXPECTED_RENDITIONS.map(({ entryName }) => entryName)] as const;
const FORBIDDEN_OUTPUT_IDENTIFIERS = new Set(['url', 'objectkey', 'locator', 'publicreference']);

export interface TrustedPhotoshopPublicationPackageEntry {
  name: string;
  buffer: Buffer;
}

export interface TrustedPhotoshopPublicationPackageClaims {
  schema: 'trails.publishing-package/v1';
  packageId?: string;
  createdAt?: string;
  producer?: { name?: string; version?: string; mode?: string };
  sourceAssetId?: string;
}

export interface TrustedPhotoshopPublicationPackageJpeg {
  logicalRendition: (typeof EXPECTED_RENDITIONS)[number]['logicalRendition'];
  buffer: Buffer;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export interface TrustedPhotoshopPublicationPackage {
  claims: TrustedPhotoshopPublicationPackageClaims;
  jpegs: TrustedPhotoshopPublicationPackageJpeg[];
}

/** A redacted boundary error; manifest and decoder details never leave this module. */
export class TrustedPhotoshopPublicationPackageImportError extends Error {
  constructor() {
    super('Trusted Photoshop publication package import failed');
    this.name = 'TrustedPhotoshopPublicationPackageImportError';
  }
}

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

const hasForbiddenOutputIdentifier = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasForbiddenOutputIdentifier);
  if (!isJsonObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => FORBIDDEN_OUTPUT_IDENTIFIERS.has(key.toLowerCase()) || hasForbiddenOutputIdentifier(nested));
};

const outputMatches = (output: JsonObject, filename: string, presetId: string): boolean => {
  return output.relativePath === `website/${filename}`
    && output.filename === filename
    && output.presetId === presetId
    && output.status === 'saved';
};

const parseClaims = (manifestBuffer: Buffer): TrustedPhotoshopPublicationPackageClaims => {
  if (manifestBuffer.length > MAX_MANIFEST_BYTES) throw new Error('Manifest exceeds bound');

  const manifest: unknown = JSON.parse(manifestBuffer.toString('utf8'));
  if (!isJsonObject(manifest) || manifest.schema !== 'trails.publishing-package/v1' || manifest.outcome !== 'complete' || !Array.isArray(manifest.outputs)) {
    throw new Error('Invalid manifest');
  }

  const outputs = manifest.outputs;
  if (!outputs.every(isJsonObject) || outputs.some(hasForbiddenOutputIdentifier)) throw new Error('Invalid outputs');
  for (const rendition of EXPECTED_RENDITIONS) {
    if (outputs.filter((output) => outputMatches(output, rendition.filename, rendition.presetId)).length !== 1) {
      throw new Error('Invalid output mapping');
    }
  }
  if (outputs.length !== EXPECTED_RENDITIONS.length) throw new Error('Unexpected output');

  const producerValue = isJsonObject(manifest.producer) ? manifest.producer : undefined;
  const producer = producerValue === undefined ? undefined : {
    name: optionalString(producerValue.name),
    version: optionalString(producerValue.version),
    mode: optionalString(producerValue.mode),
  };

  return {
    schema: 'trails.publishing-package/v1',
    packageId: optionalString(manifest.packageId),
    createdAt: optionalString(manifest.createdAt),
    ...(producer === undefined ? {} : { producer }),
    sourceAssetId: optionalString(isJsonObject(manifest.sourceAsset) ? manifest.sourceAsset.assetId : manifest.sourceAssetId),
  };
};

const orientedDimensions = (width: number, height: number, orientation: number | undefined): [number, number] => (
  orientation !== undefined && orientation >= 5 && orientation <= 8 ? [height, width] : [width, height]
);

const inspectJpeg = async (
  buffer: Buffer,
  logicalRendition: TrustedPhotoshopPublicationPackageJpeg['logicalRendition'],
  longestEdge: number,
): Promise<TrustedPhotoshopPublicationPackageJpeg> => {
  const metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 }).metadata();
  if (
    metadata.format !== 'jpeg'
    || !metadata.width
    || !metadata.height
    || metadata.width <= 0
    || metadata.height <= 0
    || !metadata.channels
    || metadata.channels > MAX_INPUT_CHANNELS
    || (metadata.pages !== undefined && metadata.pages !== 1)
  ) throw new Error('Invalid JPEG');

  const [width, height] = orientedDimensions(metadata.width, metadata.height, metadata.orientation);
  if (Math.max(width, height) > longestEdge) throw new Error('Invalid rendition dimensions');
  return {
    logicalRendition,
    buffer,
    width,
    height,
    byteLength: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
};

/**
 * Imports one already-materialized Photoshop website publication package entirely in memory.
 * This is a validation boundary, not an extractor, processor, uploader, registry, or publisher.
 */
export const importTrustedPhotoshopPublicationPackage = async (
  entries: readonly TrustedPhotoshopPublicationPackageEntry[],
): Promise<TrustedPhotoshopPublicationPackage> => {
  try {
    if (entries.length !== EXPECTED_ENTRY_NAMES.length) throw new Error('Unexpected entry count');
    const entryByName = new Map<string, Buffer>();
    for (const entry of entries) {
      if (!EXPECTED_ENTRY_NAMES.includes(entry.name as (typeof EXPECTED_ENTRY_NAMES)[number]) || !Buffer.isBuffer(entry.buffer) || entryByName.has(entry.name)) {
        throw new Error('Invalid entry');
      }
      entryByName.set(entry.name, entry.buffer);
    }
    if (EXPECTED_ENTRY_NAMES.some((name) => !entryByName.has(name))) throw new Error('Missing entry');

    const claims = parseClaims(entryByName.get('manifest.json')!);
    const jpegs: TrustedPhotoshopPublicationPackageJpeg[] = [];
    for (const rendition of EXPECTED_RENDITIONS) {
      jpegs.push(await inspectJpeg(entryByName.get(rendition.entryName)!, rendition.logicalRendition, rendition.longestEdge));
    }
    return { claims, jpegs };
  } catch (error: unknown) {
    if (error instanceof TrustedPhotoshopPublicationPackageImportError) throw error;
    throw new TrustedPhotoshopPublicationPackageImportError();
  }
};

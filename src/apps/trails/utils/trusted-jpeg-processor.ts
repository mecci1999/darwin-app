import sharp from 'sharp';
import { createHash } from 'crypto';

const MAX_INPUT_PIXELS = 64_000_000;
const MAX_INPUT_CHANNELS = 4;

const RENDITIONS = [
  { name: 'grid-960', target: 960 },
  { name: 'cover-2048', target: 2048 },
  { name: 'preview-4096', target: 4096 },
] as const;

const FORMATS = ['avif', 'webp', 'jpeg'] as const;

export type TrustedJpegRenditionName = (typeof RENDITIONS)[number]['name'];
export type TrustedJpegDerivativeFormat = (typeof FORMATS)[number];

/**
 * A standalone, in-memory derivative. It deliberately contains no source identity,
 * public reference, locator, URL, object key, registry state, or storage information.
 */
export interface TrustedJpegDerivative {
  name: TrustedJpegRenditionName;
  format: TrustedJpegDerivativeFormat;
  buffer: Buffer;
  mime: 'image/avif' | 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

/** A redacted boundary error: decoder and source details are never exposed to callers. */
export class TrustedJpegProcessingError extends Error {
  constructor() {
    super('Trusted JPEG derivative processing failed');
    this.name = 'TrustedJpegProcessingError';
  }
}

const mimeByFormat: Record<TrustedJpegDerivativeFormat, TrustedJpegDerivative['mime']> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

const createInputPipeline = (input: Buffer) => sharp(input, {
  limitInputPixels: MAX_INPUT_PIXELS,
  pages: 1,
});

/**
 * Creates the nine Trails logical image derivatives from an already trusted JPEG buffer.
 *
 * The processor is server-only and entirely in-memory: it neither reads nor writes files,
 * calls storage/COS/CDN, registers artifacts, or creates public references. It accepts only
 * bytes from an established trusted server-side boundary, never a filename, URL, locator, or
 * request object. All outputs are decoded and re-encoded without `withMetadata()`, omitting
 * EXIF, XMP, and embedded ICC metadata. Pixel data is explicitly converted to sRGB before
 * encoding, while no source colour profile is retained in output metadata.
 *
 * Every artifact begins with a fresh Sharp pipeline, normalizes EXIF orientation via
 * `rotate()`, fits its named longest-edge target without cropping or enlargement, and returns
 * only after all nine encodes have succeeded. Failures are redacted and atomic at this API
 * boundary: this function rejects instead of returning a partial artifact collection.
 */
export const processTrustedJpegDerivatives = async (input: Buffer): Promise<TrustedJpegDerivative[]> => {
  try {
    const metadata = await createInputPipeline(input).metadata();

    if (
      metadata.format !== 'jpeg'
      || !metadata.width
      || !metadata.height
      || metadata.width <= 0
      || metadata.height <= 0
      || !metadata.channels
      || metadata.channels > MAX_INPUT_CHANNELS
      || (metadata.pages !== undefined && metadata.pages !== 1)
    ) {
      throw new Error('Invalid trusted JPEG input');
    }

    const derivatives: TrustedJpegDerivative[] = [];
    for (const { name, target } of RENDITIONS) {
      for (const format of FORMATS) {
        let pipeline = createInputPipeline(input)
          .rotate()
          .toColourspace('srgb')
          .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true });

        if (format === 'avif') pipeline = pipeline.avif({ quality: 55, effort: 4 });
        if (format === 'webp') pipeline = pipeline.webp({ quality: 82, effort: 4 });
        if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 86, mozjpeg: true });

        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        if (!info.width || !info.height) throw new Error('Invalid derivative dimensions');

        derivatives.push({
          name,
          format,
          buffer: data,
          mime: mimeByFormat[format],
          width: info.width,
          height: info.height,
          byteLength: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        });
      }
    }

    return derivatives;
  } catch (error: unknown) {
    if (error instanceof TrustedJpegProcessingError) throw error;
    throw new TrustedJpegProcessingError();
  }
};

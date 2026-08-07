import sharp from 'sharp';
import {
  processTrustedJpegDerivatives,
  TrustedJpegProcessingError,
} from '../../src/apps/starlight/trails/utils/trusted-jpeg-processor';

const buildJpeg = (width: number, height: number, options: { orientation?: number; withMetadata?: boolean } = {}) => {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 32, g: 96, b: 160 } },
  });

  if (options.withMetadata) {
    pipeline = pipeline.withMetadata({ orientation: options.orientation, icc: 'srgb' });
  }

  return pipeline.jpeg({ quality: 90 }).toBuffer();
};

const expectedDimensions = (width: number, height: number, target: number): [number, number] => {
  const scale = Math.min(target / Math.max(width, height), 1);
  return [Math.round(width * scale), Math.round(height * scale)];
};

describe('Trails trusted JPEG derivative processor', () => {
  it('creates only the nine requested in-memory artifacts, preserving a landscape aspect ratio', async () => {
    const source = await buildJpeg(3200, 1200);
    const artifacts = await processTrustedJpegDerivatives(source);

    expect(artifacts).toHaveLength(9);
    expect(artifacts.map(({ name, format }) => `${name}:${format}`)).toEqual([
      'grid-800:avif', 'grid-800:webp', 'grid-800:jpeg',
      'cover-1600:avif', 'cover-1600:webp', 'cover-1600:jpeg',
      'preview-2048:avif', 'preview-2048:webp', 'preview-2048:jpeg',
    ]);
    expect(artifacts.map(({ name, format }) => `${name}:${format}`).sort()).toEqual([
      'cover-1600:avif', 'cover-1600:jpeg', 'cover-1600:webp',
      'grid-800:avif', 'grid-800:jpeg', 'grid-800:webp',
      'preview-2048:avif', 'preview-2048:jpeg', 'preview-2048:webp',
    ]);

    for (const artifact of artifacts) {
      const target = artifact.name === 'grid-800' ? 800 : artifact.name === 'cover-1600' ? 1600 : 2048;
      const [width, height] = expectedDimensions(3200, 1200, target);
      const metadata = await sharp(artifact.buffer).metadata();

      expect(artifact).toEqual(expect.objectContaining({ width, height, byteLength: artifact.buffer.length }));
      expect(artifact.buffer.length).toBeGreaterThan(0);
      expect(metadata).toEqual(expect.objectContaining({
        format: artifact.format === 'avif' ? 'heif' : artifact.format,
        width,
        height,
      }));
      expect(artifact).not.toHaveProperty('source');
      expect(artifact).not.toHaveProperty('filename');
      expect(artifact).not.toHaveProperty('locator');
      expect(artifact).not.toHaveProperty('url');
      expect(artifact).not.toHaveProperty('objectKey');
      expect(artifact).not.toHaveProperty('publicReference');
    }
  });

  it('preserves portrait dimensions, does not upscale, and emits accurate MIME values', async () => {
    const artifacts = await processTrustedJpegDerivatives(await buildJpeg(400, 700));

    for (const artifact of artifacts) {
      expect(artifact.width).toBe(400);
      expect(artifact.height).toBe(700);
      expect(artifact.mime).toBe(`image/${artifact.format === 'jpeg' ? 'jpeg' : artifact.format}`);
    }
  });

  it('normalizes EXIF orientation before resizing', async () => {
    const artifacts = await processTrustedJpegDerivatives(await buildJpeg(400, 1200, { orientation: 6, withMetadata: true }));

    for (const artifact of artifacts) {
      const target = artifact.name === 'grid-800' ? 800 : artifact.name === 'cover-1600' ? 1600 : 2048;
      const [width, height] = expectedDimensions(1200, 400, target);
      expect(artifact.width).toBe(width);
      expect(artifact.height).toBe(height);
      expect((await sharp(artifact.buffer).metadata()).orientation).toBeUndefined();
    }
  });

  it('omits inspectable EXIF, XMP, and ICC metadata from every re-encoded derivative', async () => {
    const artifacts = await processTrustedJpegDerivatives(await buildJpeg(1200, 800, { orientation: 6, withMetadata: true }));

    for (const artifact of artifacts) {
      const metadata = await sharp(artifact.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  });

  it.each([
    ['non-JPEG', () => sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toBuffer()],
    ['corrupt bytes', () => Promise.resolve(Buffer.from('not an image'))],
    ['pixel-limit JPEG', () => sharp({ create: { width: 8001, height: 8000, channels: 3, background: 'red' } }).jpeg().toBuffer()],
    ['multi-page GIF', async () => sharp([
      await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toBuffer(),
      await sharp({ create: { width: 20, height: 20, channels: 3, background: 'blue' } }).png().toBuffer(),
    ], { join: { animated: true } }).gif().toBuffer()],
  ])('rejects %s with a redacted atomic error', async (_caseName, createInput) => {
    await expect(processTrustedJpegDerivatives(await createInput())).rejects.toEqual(expect.any(TrustedJpegProcessingError));
    await expect(processTrustedJpegDerivatives(await createInput())).rejects.toThrow('Trusted JPEG derivative processing failed');
  });
});

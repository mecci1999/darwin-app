import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import {
  processTrustedPhotoshopPackageDerivatives,
  TrustedPhotoshopPackageDerivativeOrchestrationError,
} from '../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator';

const jpeg = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: 'navy' },
}).jpeg().toBuffer();

const outputs = [
  { relativePath: 'website/grid-960.v1.jpg', filename: 'grid-960.v1.jpg', presetId: 'website-grid-960', status: 'saved' },
  { relativePath: 'website/cover-2048.v1.jpg', filename: 'cover-2048.v1.jpg', presetId: 'website-cover-2048', status: 'saved' },
  { relativePath: 'website/preview-4096.v1.jpg', filename: 'preview-4096.v1.jpg', presetId: 'website-preview-4096', status: 'saved' },
];

const packageEntries = async () => [
  { name: 'manifest.json', buffer: Buffer.from(JSON.stringify({
    schema: 'trails.publishing-package/v1', outcome: 'complete', outputs, packageId: 'package-1',
    createdAt: '2026-08-02T00:00:00.000Z', producer: { name: 'Photoshop', version: '1', mode: 'uxp' },
    sourceAssetId: 'source-identity-must-not-leak', documentName: 'private.psd', approvals: ['private'],
  })) },
  { name: 'website/grid-960.v1.jpg', buffer: await jpeg(960, 400) },
  { name: 'website/cover-2048.v1.jpg', buffer: await jpeg(2048, 960) },
  { name: 'website/preview-4096.v1.jpg', buffer: await jpeg(4096, 1024) },
];

describe('Trails trusted Photoshop package derivative orchestrator', () => {
  afterEach(() => {
    jest.dontMock('../../src/apps/trails/utils/trusted-jpeg-processor');
    jest.resetModules();
  });

  it('selects only the verified preview rendition and returns narrow audited in-memory results', async () => {
    const entries = await packageEntries();
    const preview = entries[3].buffer;
    const result = await processTrustedPhotoshopPackageDerivatives(entries);

    expect(result.claims).toEqual({
      schema: 'trails.publishing-package/v1', packageId: 'package-1', createdAt: '2026-08-02T00:00:00.000Z',
      producer: { name: 'Photoshop', version: '1', mode: 'uxp' },
    });
    expect(result.source).toEqual({
      logicalRendition: 'preview-4096', width: 4096, height: 1024, byteLength: preview.length,
      sha256: createHash('sha256').update(preview).digest('hex'),
    });
    expect(result.derivatives).toHaveLength(9);
    expect(result.derivatives.map(({ name, format }) => `${name}:${format}`)).toEqual([
      'grid-960:avif', 'grid-960:webp', 'grid-960:jpeg',
      'cover-2048:avif', 'cover-2048:webp', 'cover-2048:jpeg',
      'preview-4096:avif', 'preview-4096:webp', 'preview-4096:jpeg',
    ]);
    expect(result.source).not.toHaveProperty('buffer');
    expect(result.claims).not.toHaveProperty('sourceAssetId');
    expect(JSON.stringify(result)).not.toContain('private.psd');
    expect(JSON.stringify(result)).not.toContain('source-identity-must-not-leak');
    for (const derivative of result.derivatives) {
      expect(derivative).not.toHaveProperty('source');
      expect(derivative).not.toHaveProperty('url');
      expect(derivative).not.toHaveProperty('locator');
      expect(derivative).not.toHaveProperty('objectKey');
      expect(derivative).not.toHaveProperty('publicReference');
    }
  });

  it('redacts malformed-package failures without returning a partial result', async () => {
    const entries = await packageEntries();
    entries[3].buffer = Buffer.from('not an image');

    await expect(processTrustedPhotoshopPackageDerivatives(entries)).rejects.toEqual(expect.any(TrustedPhotoshopPackageDerivativeOrchestrationError));
    await expect(processTrustedPhotoshopPackageDerivatives(entries)).rejects.toThrow('Trusted Photoshop package derivative processing failed');
  });

  it('redacts an encoder rejection atomically', async () => {
    jest.resetModules();
    jest.doMock('../../src/apps/trails/utils/trusted-jpeg-processor', () => {
      const actual = jest.requireActual<typeof import('../../src/apps/trails/utils/trusted-jpeg-processor')>(
        '../../src/apps/trails/utils/trusted-jpeg-processor',
      );
      return { ...actual, processTrustedJpegDerivatives: jest.fn().mockRejectedValue(new Error('private encoder detail')) };
    });
    const { processTrustedPhotoshopPackageDerivatives: processWithRejectedEncoder }: typeof import('../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator') = require('../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator');
    const { processTrustedJpegDerivatives }: typeof import('../../src/apps/trails/utils/trusted-jpeg-processor') = require('../../src/apps/trails/utils/trusted-jpeg-processor');

    await expect(processWithRejectedEncoder(await packageEntries())).rejects.toMatchObject({
      name: 'TrustedPhotoshopPackageDerivativeOrchestrationError',
    });
    await expect(processWithRejectedEncoder(await packageEntries())).rejects.toThrow('Trusted Photoshop package derivative processing failed');
    expect(processTrustedJpegDerivatives).toHaveBeenCalledTimes(2);
  });

  it('depends only on the importer and trusted JPEG processor', () => {
    const source = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator'), 'utf8');
    expect(source).toMatch(/from ['"]\.\/trusted-photoshop-publication-package-importer['"]/);
    expect(source).toMatch(/from ['"]\.\/trusted-jpeg-processor['"]/);
    expect(source).not.toMatch(/from ['"](?:fs|path|stream|fflate|.*registry|.*actions|.*storage|.*delivery)['"]/);
    expect(source).not.toMatch(/(?:createReadStream\(|readFile\(|writeFile\(|\.upload\(|https?:\/\/|COS|CDN)/);
  });
});

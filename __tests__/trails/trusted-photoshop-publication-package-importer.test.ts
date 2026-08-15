import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import {
  importTrustedPhotoshopPublicationPackage,
  TrustedPhotoshopPublicationPackageImportError,
} from '../../src/apps/trails/utils/trusted-photoshop-publication-package-importer';

const jpeg = (width: number, height: number, orientation?: number) => {
  let image = sharp({ create: { width, height, channels: 3, background: 'navy' } });
  if (orientation !== undefined) image = image.withMetadata({ orientation });
  return image.jpeg().toBuffer();
};

const manifest = (outputs: unknown, extra: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  schema: 'trails.publishing-package/v1', outcome: 'complete', outputs, packageId: 'package-1', createdAt: '2026-08-02T00:00:00.000Z',
  producer: { name: 'Photoshop', version: '1', mode: 'uxp' }, sourceAssetId: 'source-1', documentName: 'private.psd', approvals: ['private'], ...extra,
}));

const outputs = [
  { relativePath: 'website/grid-800.v1.jpg', filename: 'grid-800.v1.jpg', presetId: 'website-grid-800', status: 'saved' },
  { relativePath: 'website/cover-1600.v1.jpg', filename: 'cover-1600.v1.jpg', presetId: 'website-cover-1600', status: 'saved' },
  { relativePath: 'website/preview-2048.v1.jpg', filename: 'preview-2048.v1.jpg', presetId: 'website-preview-2048', status: 'saved' },
];

const packageEntries = async (manifestBuffer = manifest(outputs)) => [
  { name: 'manifest.json', buffer: manifestBuffer },
  { name: 'website/grid-800.v1.jpg', buffer: await jpeg(800, 400) },
  { name: 'website/cover-1600.v1.jpg', buffer: await jpeg(1600, 800) },
  { name: 'website/preview-2048.v1.jpg', buffer: await jpeg(2048, 1024) },
];

const expectRejected = async (entries: Awaited<ReturnType<typeof packageEntries>>) => {
  await expect(importTrustedPhotoshopPublicationPackage(entries)).rejects.toEqual(expect.any(TrustedPhotoshopPublicationPackageImportError));
  await expect(importTrustedPhotoshopPublicationPackage(entries)).rejects.toThrow('Trusted Photoshop publication package import failed');
};

describe('Trails trusted Photoshop website publication package importer', () => {
  it('returns narrow CEP/UXP claims and server-verified JPEG facts in rendition order', async () => {
    const uxpOutputs = outputs.map((output) => ({ ...output, outputId: `output-${output.presetId}`, sourceAssetId: 'source-1', registryVersion: '2026.07.0', path: '/private/export/path.jpg' }));
    const result = await importTrustedPhotoshopPublicationPackage(await packageEntries(manifest(uxpOutputs, { sourceAsset: { assetId: 'source-1', documentName: 'private.psd' } })));

    expect(result.claims).toEqual({ schema: 'trails.publishing-package/v1', packageId: 'package-1', createdAt: '2026-08-02T00:00:00.000Z', producer: { name: 'Photoshop', version: '1', mode: 'uxp' }, sourceAssetId: 'source-1' });
    expect(result.jpegs.map(({ logicalRendition }) => logicalRendition)).toEqual(['grid-800', 'cover-1600', 'preview-2048']);
    expect(result.jpegs.map(({ width, height }) => [width, height])).toEqual([[800, 400], [1600, 800], [2048, 1024]]);
    for (const image of result.jpegs) {
      expect(image.byteLength).toBe(image.buffer.length);
      expect(image.sha256).toBe(createHash('sha256').update(image.buffer).digest('hex'));
      expect(JSON.stringify(image)).not.toContain('private.psd');
    }
    expect(JSON.stringify(result.claims)).not.toContain('documentName');
    expect(result.claims).not.toHaveProperty('outcome');
    expect(result.claims).not.toHaveProperty('approvals');
  });

  it('accepts the flat CEP output shape without requiring UXP-only fields', async () => {
    const cepOutputs = outputs.map(({ relativePath, filename, presetId, status }) => ({ relativePath, filename, presetId, status, geometry: {}, profilePolicy: {}, approvals: {}, duplicateCleanup: {} }));

    const result = await importTrustedPhotoshopPublicationPackage(await packageEntries(manifest(cepOutputs, { sourceAsset: { assetId: 'cep-source', documentName: 'private.psd' } })));

    expect(result.claims.sourceAssetId).toBe('cep-source');
    expect(result.jpegs.map(({ logicalRendition }) => logicalRendition)).toEqual(['grid-800', 'cover-1600', 'preview-2048']);
  });

  it('uses orientation-aware JPEG facts', async () => {
    const entries = await packageEntries();
    entries[1].buffer = await jpeg(400, 800, 6);
    const result = await importTrustedPhotoshopPublicationPackage(entries);
    expect(result.jpegs[0]).toEqual(expect.objectContaining({ width: 800, height: 400 }));
  });

  it.each([
    ['extra social entry', async () => [...await packageEntries(), { name: 'social/post.jpg', buffer: Buffer.from('x') }]],
    ['hidden entry', async () => [...await packageEntries(), { name: '.DS_Store', buffer: Buffer.from('x') }]],
    ['duplicate entry', async () => { const entries = await packageEntries(); return [...entries, entries[1]]; }],
    ['missing entry', async () => (await packageEntries()).slice(0, 3)],
    ['alternate casing', async () => { const entries = await packageEntries(); entries[1].name = 'website/Grid-800.v1.jpg'; return entries; }],
    ['traversal', async () => { const entries = await packageEntries(); entries[1].name = 'website/../grid-800.v1.jpg'; return entries; }],
    ['backslash', async () => { const entries = await packageEntries(); entries[1].name = 'website\\grid-800.v1.jpg'; return entries; }],
    ['absolute path', async () => { const entries = await packageEntries(); entries[1].name = '/website/grid-800.v1.jpg'; return entries; }],
    ['URL', async () => { const entries = await packageEntries(); entries[1].name = 'https://example.test/grid-800.v1.jpg'; return entries; }],
    ['control trick', async () => { const entries = await packageEntries(); entries[1].name = 'website/grid-800.v1.jpg\u0000'; return entries; }],
    ['percent trick', async () => { const entries = await packageEntries(); entries[1].name = 'website/%67rid-800.v1.jpg'; return entries; }],
  ])('rejects package safety violation: %s', async (_name, create) => expectRejected(await create()));

  it.each([
    ['invalid JSON', () => Buffer.from('{')],
    ['wrong schema', () => manifest(outputs, { schema: 'other/v1' })],
    ['partial outcome', () => manifest(outputs, { outcome: 'partial' })],
    ['missing output', () => manifest(outputs.slice(0, 2))],
    ['duplicate claim', () => manifest([outputs[0], outputs[0], outputs[2]])],
    ['wrong full relative path', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, relativePath: 'website' } : output))],
    ['wrong website preset ID', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, presetId: 'grid-800' } : output))],
    ['unsaved website output', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, status: 'failed-no-artifact' } : output))],
    ['URL output field', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, url: 'https://example.test/x' } : output))],
    ['object-key output field', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, objectKey: 'private' } : output))],
    ['locator output field', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, locator: 'private' } : output))],
    ['public-reference output field', () => manifest(outputs.map((output, index) => index === 0 ? { ...output, publicReference: 'private' } : output))],
  ])('rejects manifest violation: %s', async (_name, createManifest) => expectRejected(await packageEntries(createManifest())));

  it.each([
    ['PNG disguised as JPEG', async () => sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toBuffer()],
    ['corrupt JPEG', async () => Buffer.from('not an image')],
    ['pixel limit', async () => sharp({ create: { width: 8001, height: 8000, channels: 3, background: 'red' } }).jpeg().toBuffer()],
    ['grid named dimension', async () => jpeg(801, 400)],
  ])('rejects invalid source bytes: %s', async (_name, createImage) => {
    const entries = await packageEntries();
    entries[1].buffer = await createImage();
    await expectRejected(entries);
  });

  it('has no filesystem, archive, request, storage, registry, processing, or delivery dependency', () => {
    const source = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-photoshop-publication-package-importer'), 'utf8');
    expect(source).not.toMatch(/from ['"](?:fs|path|stream|fflate|sharp.*processor|.*registry|.*actions|.*delivery)['"]/);
    expect(source).not.toMatch(/(?:processTrustedJpegDerivatives|createReadStream\(|readFile\(|writeFile\(|\.upload\()/);
  });
});

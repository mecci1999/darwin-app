import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { processTrustedPhotoshopPackageDerivatives } from '../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator';
import {
  stageTrustedPhotoshopPackageDerivatives,
  TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT,
  TrustedPhotoshopDerivativeStagingPlanError,
} from '../../src/apps/trails/utils/trusted-photoshop-derivative-staging-plan';

const jpeg = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: 'navy' },
}).jpeg().toBuffer();

const outputs = [
  { relativePath: 'website/grid-800.v1.jpg', filename: 'grid-800.v1.jpg', presetId: 'website-grid-800', status: 'saved' },
  { relativePath: 'website/cover-1600.v1.jpg', filename: 'cover-1600.v1.jpg', presetId: 'website-cover-1600', status: 'saved' },
  { relativePath: 'website/preview-2048.v1.jpg', filename: 'preview-2048.v1.jpg', presetId: 'website-preview-2048', status: 'saved' },
];

const packageEntries = async () => [
  { name: 'manifest.json', buffer: Buffer.from(JSON.stringify({
    schema: 'trails.publishing-package/v1', outcome: 'complete', outputs, packageId: 'package-1',
    createdAt: '2026-08-02T00:00:00.000Z', producer: { name: 'Photoshop', version: '1', mode: 'uxp' },
    sourceAssetId: 'source-identity-must-not-leak', documentName: 'private.psd', tenantId: 'tenant-must-not-leak',
  })) },
  { name: 'website/grid-800.v1.jpg', buffer: await jpeg(800, 400) },
  { name: 'website/cover-1600.v1.jpg', buffer: await jpeg(1600, 800) },
  { name: 'website/preview-2048.v1.jpg', buffer: await jpeg(2048, 1024) },
];

const orchestration = async () => processTrustedPhotoshopPackageDerivatives(await packageEntries());

describe('Trails trusted Photoshop derivative staging plan', () => {
  it('stages actual orchestrator output as the exact private 3×3 codec matrix', async () => {
    const result = await orchestration();
    const plan = stageTrustedPhotoshopPackageDerivatives(result);

    expect(plan.contract).toBe(TRUSTED_PHOTOSHOP_DERIVATIVE_STAGING_PLAN_CONTRACT);
    expect(plan.artifacts.map(({ slot }) => slot)).toEqual([
      'grid-800:avif', 'grid-800:webp', 'grid-800:jpeg',
      'cover-1600:avif', 'cover-1600:webp', 'cover-1600:jpeg',
      'preview-2048:avif', 'preview-2048:webp', 'preview-2048:jpeg',
    ]);
    expect(plan.artifacts).toHaveLength(9);
    for (const [index, artifact] of plan.artifacts.entries()) {
      expect(Object.keys(artifact).sort()).toEqual([
        'buffer', 'byteLength', 'codec', 'height', 'logicalRendition', 'mime', 'sha256', 'slot', 'width',
      ]);
      expect(artifact.buffer).toBe(result.derivatives[index].buffer);
      expect(artifact.sha256).toBe(createHash('sha256').update(artifact.buffer).digest('hex'));
      expect(artifact.byteLength).toBe(artifact.buffer.length);
    }
  });

  it('redacts and atomically rejects missing, duplicate, unexpected, MIME, dimension, length, and hash invariant failures', async () => {
    const cases: ReadonlyArray<(result: Awaited<ReturnType<typeof orchestration>>) => void> = [
      (result) => { result.derivatives.pop(); },
      (result) => { result.derivatives[1] = { ...result.derivatives[1], name: 'grid-800', format: 'avif' }; },
      (result) => { result.derivatives[1] = { ...result.derivatives[1], name: 'unexpected-rendition' as 'grid-800' }; },
      (result) => { result.derivatives[0] = { ...result.derivatives[0], mime: 'image/jpeg' }; },
      (result) => { result.derivatives[0] = { ...result.derivatives[0], width: 799 }; },
      (result) => { result.derivatives[0] = { ...result.derivatives[0], byteLength: result.derivatives[0].buffer.length + 1 }; },
      (result) => { result.derivatives[0] = { ...result.derivatives[0], sha256: 'f'.repeat(64) }; },
    ];

    for (const corrupt of cases) {
      const result = await orchestration();
      corrupt(result);
      expect(() => stageTrustedPhotoshopPackageDerivatives(result)).toThrow(TrustedPhotoshopDerivativeStagingPlanError);
      expect(() => stageTrustedPhotoshopPackageDerivatives(result)).toThrow('Trusted Photoshop derivative staging plan failed');
    }
  });

  it('does not mutate input or expose identity, ownership, lifecycle, storage, or public-delivery fields', async () => {
    const result = await orchestration();
    const before = result.derivatives.map((derivative) => ({ ...derivative }));
    const plan = stageTrustedPhotoshopPackageDerivatives(result);
    const serializedShape = JSON.stringify({ ...plan, artifacts: plan.artifacts.map(({ buffer, ...artifact }) => artifact) });

    expect(result.derivatives).toEqual(before);
    expect(plan.source).toEqual(result.source);
    expect(plan.source).not.toHaveProperty('buffer');
    for (const forbidden of [
      'asset', 'tenant', 'owner', 'mutation', 'status', 'storage', 'locator', 'objectKey', 'capability', 'url',
      'publicReference', 'derivativeKey', 'sourceAssetId', 'documentName',
    ]) expect(serializedShape).not.toContain(forbidden);
    expect(serializedShape).not.toContain('private.psd');
    expect(serializedShape).not.toContain('source-identity-must-not-leak');
  });

  it('depends only on crypto and trusted in-memory derivative contracts', () => {
    const source = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-photoshop-derivative-staging-plan'), 'utf8');
    expect(source).toMatch(/from ['"]crypto['"]/);
    expect(source).toMatch(/from ['"]\.\/trusted-photoshop-package-derivative-orchestrator['"]/);
    expect(source).not.toMatch(/from ['"](?:fs|path|stream|fflate|sequelize|.*registry|.*actions|.*storage|.*delivery|.*cos)['"]/i);
    expect(source).not.toMatch(/(?:readFile\(|writeFile\(|createReadStream\(|createWriteStream\(|\.upload\(|\.send\(|https?:\/\/|COS\.|CDN\.|sequelize\.)/i);
  });
});

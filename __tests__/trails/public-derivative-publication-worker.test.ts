import { Readable } from 'stream';
import sharp from 'sharp';
import { TrailsPublicDerivativePublicationJob, runOneTrailsPublicDerivativePublicationJob, trailsPublicDerivativeCacheControl } from '../../src/apps/trails/workers/public-derivative-publication-worker';

const owner = { tenantId: 'tenant_1', userId: 'owner_1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' as const };
const sha = (value: Buffer) => require('crypto').createHash('sha256').update(value).digest('hex');
const jpeg = async (width: number) => sharp({ create: { width, height: 10, channels: 3, background: '#123456' } }).jpeg().toBuffer();

describe('Trails public derivative publication worker', () => {
  const job = async (): Promise<{ value: TrailsPublicDerivativePublicationJob; images: Map<string, Buffer> }> => {
    const images = new Map<string, Buffer>();
    const artifacts: TrailsPublicDerivativePublicationJob['artifacts'][number][] = [];
    for (const rendition of ['grid-960', 'cover-2048', 'preview-4096'] as const) for (const codec of ['avif', 'webp', 'jpeg'] as const) {
      const content = codec === 'jpeg' ? await jpeg(rendition === 'grid-960' ? 8 : rendition === 'cover-2048' ? 16 : 20) : Buffer.from(`${rendition}-${codec}`);
      const locator = `${rendition}_${codec}`;
      images.set(locator, content);
      artifacts.push({ logicalRendition: rendition, codec, privateLocator: locator, mimeType: `image/${codec}` as 'image/avif' | 'image/webp' | 'image/jpeg', width: rendition === 'grid-960' ? 8 : rendition === 'cover-2048' ? 16 : 20, height: 10, byteLength: content.length, sha256: sha(content) });
    }
    return { value: { jobId: 'job_1', actor: owner, assetId: 'asset_1', expectedResourceVersion: '2', approvalId: 'approval_1', artifacts, publicReferences: { 'grid-960': 'reference_grid', 'cover-2048': 'reference_cover', 'preview-4096': 'reference_preview' } }, images };
  };

  it('publishes and verifies only the three approved private JPEGs before approving and publishing the registry asset', async () => {
    const fixture = await job(); const written: string[] = []; const approved: unknown[] = []; const published: unknown[] = [];
    const result = await runOneTrailsPublicDerivativePublicationJob({
      jobs: { async takeOne() { return fixture.value; } }, credentialProvider: { async getCredentials() { return { mode: 'workload-identity' }; } },
      privateLocatorResolver: { async openPrivateJpeg(locator) { const content = fixture.images.get(locator); if (!content) throw new Error('unknown locator'); return { body: Readable.from(content), contentType: 'image/jpeg', byteLength: content.length }; } },
      objectStore: { async putImmutable(input) { written.push(input.key); await new Promise<void>((resolve, reject) => { input.body.on('error', reject); input.body.on('end', resolve); input.body.resume(); }); }, async head(input) { const locator = input.key.includes('grid') ? 'grid-960_jpeg' : input.key.includes('cover') ? 'cover-2048_jpeg' : 'preview-4096_jpeg'; const content = fixture.images.get(locator)!; return { contentType: 'image/jpeg', cacheControl: trailsPublicDerivativeCacheControl, contentLength: content.length, sha256: sha(content) }; } },
      registry: {
        async approvePublicDerivatives(_actor, input) { approved.push(input); return { id: 'asset_1', status: 'draft' as const, resourceVersion: '3' }; },
        async publish(_actor, input) { published.push(input); return { id: 'asset_1', status: 'published' as const, resourceVersion: '4' }; },
      },
    });
    expect(result).toEqual({ outcome: 'published', jobId: 'job_1', assetId: 'asset_1' });
    expect(written).toEqual(['public-derivatives/reference_grid.jpg', 'public-derivatives/reference_cover.jpg', 'public-derivatives/reference_preview.jpg']);
    expect(approved).toEqual([expect.objectContaining({ mutationId: 'job_1:approve', publication: { approvalId: 'approval_1', identityMode: 'workload-identity' } })]);
    expect(published).toEqual([expect.objectContaining({ mutationId: 'job_1:publish', expectedResourceVersion: '3', id: 'asset_1' })]);
  });

  it('fails closed before approval for an incomplete matrix, a bad hash, or an unsafe public reference', async () => {
    for (const mutate of [(value: TrailsPublicDerivativePublicationJob) => ({ ...value, artifacts: value.artifacts.slice(0, 8) }), (value: TrailsPublicDerivativePublicationJob) => ({ ...value, artifacts: value.artifacts.map((item, index) => index === 2 ? { ...item, sha256: '0'.repeat(64) } : item) }), (value: TrailsPublicDerivativePublicationJob) => ({ ...value, publicReferences: { ...value.publicReferences, 'grid-960': '../master' } })]) {
      const fixture = await job(); let approved = false; let writes = 0;
      const result = await runOneTrailsPublicDerivativePublicationJob({ jobs: { async takeOne() { return mutate(fixture.value); } }, credentialProvider: { async getCredentials() { return { mode: 'workload-identity' }; } }, privateLocatorResolver: { async openPrivateJpeg(locator) { const content = fixture.images.get(locator)!; return { body: Readable.from(content), contentType: 'image/jpeg', byteLength: content.length }; } }, objectStore: { async putImmutable(input) { writes += 1; input.body.resume(); }, async head() { return { contentType: 'image/jpeg', cacheControl: trailsPublicDerivativeCacheControl, contentLength: 1, sha256: '0'.repeat(64) }; } }, registry: { async approvePublicDerivatives() { approved = true; return { id: 'asset_1', status: 'draft' as const, resourceVersion: '3' }; }, async publish() { return { id: 'asset_1', status: 'published' as const, resourceVersion: '4' }; } } });
      expect(result).toEqual({ outcome: 'failed', jobId: 'job_1', assetId: 'asset_1' }); expect(approved).toBe(false); expect(writes).toBe(0);
    }
  });

  it('fails without a public write when the workload identity provider fails', async () => {
    const fixture = await job(); let writes = 0; let approved = false;
    const result = await runOneTrailsPublicDerivativePublicationJob({ jobs: { async takeOne() { return fixture.value; } }, credentialProvider: { async getCredentials() { throw new Error('identity unavailable'); } }, privateLocatorResolver: { async openPrivateJpeg(locator) { const content = fixture.images.get(locator)!; return { body: Readable.from(content), contentType: 'image/jpeg', byteLength: content.length }; } }, objectStore: { async putImmutable(input) { writes += 1; input.body.resume(); }, async head() { throw new Error('must not run'); } }, registry: { async approvePublicDerivatives() { approved = true; return { id: 'asset_1', status: 'draft' as const, resourceVersion: '3' }; }, async publish() { return { id: 'asset_1', status: 'published' as const, resourceVersion: '4' }; } } });
    expect(result).toEqual({ outcome: 'failed', jobId: 'job_1', assetId: 'asset_1' }); expect(writes).toBe(0); expect(approved).toBe(false);
  });

  it('is bounded to one job and reports idle without external calls', async () => {
    const result = await runOneTrailsPublicDerivativePublicationJob({ jobs: { async takeOne() { return undefined; } }, credentialProvider: { async getCredentials() { return { mode: 'workload-identity' }; } }, privateLocatorResolver: { async openPrivateJpeg() { throw new Error('must not run'); } }, objectStore: { async putImmutable() { throw new Error('must not run'); }, async head() { throw new Error('must not run'); } }, registry: { async approvePublicDerivatives() { throw new Error('must not run'); }, async publish() { throw new Error('must not run'); } } });
    expect(result).toEqual({ outcome: 'idle' });
  });
});

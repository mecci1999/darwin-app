import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../..');

describe('Trails local operability', () => {
  it('uses the darwin-app Trails entrypoint in the production composition', () => {
    const compose = readFileSync(join(projectRoot, 'docker/docker-compose.app.yml'), 'utf8');

    expect(existsSync(join(projectRoot, 'src/apps/trails/index.ts'))).toBe(true);
    expect(compose).toContain('command: ["node", "dist/apps/trails/index.js"]');
    expect(compose).not.toContain('dist/apps/starlight/trails/index.js');
  });

  it('documents the disabled-by-default durable persistence contract in the development template', () => {
    const environmentTemplate = readFileSync(join(projectRoot, '.env.example'), 'utf8');
    const productionEnvironmentTemplate = readFileSync(join(projectRoot, '.env.production.example'), 'utf8');

    expect(environmentTemplate).toContain('TRAILS_DURABLE_PERSISTENCE_ENABLED=false');
    expect(environmentTemplate).toContain('never uses v1 memory');
    expect(environmentTemplate).toContain('Public Trails media delivery is intentionally deferred and unsupported');
    expect(environmentTemplate).toContain('do not configure TRAILS_MEDIA_PUBLIC_DELIVERY_BASE');
    expect(productionEnvironmentTemplate).toContain('TRAILS_MEDIA_PUBLICATION_ENABLED=false');
    expect(productionEnvironmentTemplate).toContain('private COS origin');
    expect(productionEnvironmentTemplate).not.toContain('TRAILS_MEDIA_PUBLIC_DELIVERY_BASE=');
    expect(productionEnvironmentTemplate).toContain('TRAILS_COS_ENABLED=false');
    expect(productionEnvironmentTemplate).toContain('TRAILS_COS_INGESTION_ENABLED=false');
    expect(productionEnvironmentTemplate).toContain('TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED=false');
    for (const key of ['TRAILS_COS_CREDENTIAL_PROVIDER=', 'TRAILS_COS_SECRET_ID=', 'TRAILS_COS_SECRET_KEY=', 'TRAILS_COS_SECURITY_TOKEN=', 'TRAILS_COS_INGESTION_MAPPING_SECRET=', 'TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET=']) expect(productionEnvironmentTemplate).not.toContain(key);
  });
});

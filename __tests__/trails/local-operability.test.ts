import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../..');

describe('Trails local operability', () => {
  it('includes the existing Trails command in the aggregate local startup script', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

    expect(packageJson.scripts['start:trails']).toBeDefined();
    expect(packageJson.scripts['start:all']).toContain('"sleep 46 && pnpm run start:trails"');
  });

  it('documents the disabled-by-default durable persistence contract in the development template', () => {
    const environmentTemplate = readFileSync(join(projectRoot, '.env.example'), 'utf8');
    const productionEnvironmentTemplate = readFileSync(join(projectRoot, '.env.production.example'), 'utf8');

    expect(environmentTemplate).toContain('TRAILS_DURABLE_PERSISTENCE_ENABLED=false');
    expect(environmentTemplate).toContain('never uses v1 memory');
    expect(environmentTemplate).toContain('Public Trails media delivery is intentionally deferred and unsupported');
    expect(environmentTemplate).toContain('do not configure TRAILS_MEDIA_PUBLIC_DELIVERY_BASE');
    expect(productionEnvironmentTemplate).toContain('Public Trails media delivery is intentionally deferred and unsupported');
    expect(productionEnvironmentTemplate).not.toContain('TRAILS_MEDIA_PUBLIC_DELIVERY_BASE=');
  });
});

import { spawnSync } from 'child_process';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const script = path.join(projectRoot, 'scripts/verify-trails-cos.ts');
const tsNode = require.resolve('ts-node/register', { paths: [projectRoot] });

function run(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['-r', tsNode, script], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8',
  });
}

describe('verify-trails-cos CLI', () => {
  it('prints only the redacted disabled result and exits nonzero without COS configuration', () => {
    const result = run({ PATH: process.env.PATH ?? '', NODE_ENV: 'development' });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"available":false,"reason":"disabled"}\n');
  });

  it('prints only the redacted misconfigured result when COS is enabled without credentials', () => {
    const result = run({ PATH: process.env.PATH ?? '', NODE_ENV: 'development', TRAILS_COS_ENABLED: 'true' });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"available":false,"reason":"misconfigured"}\n');
  });

  it('does not print an unsupported static-env token', () => {
    const token = 'short-lived-security-token';
    const result = run({
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'development',
      TRAILS_COS_ENABLED: 'true',
      TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
      TRAILS_COS_SECRET_ID: 'development-only-id',
      TRAILS_COS_SECRET_KEY: 'development-only-key',
      TRAILS_COS_SECURITY_TOKEN: token,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"available":false,"reason":"misconfigured"}\n');
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  });
});

import { createTrailsCosVerifier, TrailsCosVerificationStatus } from '../src/apps/trails/cos-verification';

const unavailable = (): TrailsCosVerificationStatus => ({ available: false, reason: 'unavailable' });

async function main(): Promise<void> {
  let status: TrailsCosVerificationStatus;
  try {
    status = await createTrailsCosVerifier().verify();
  } catch {
    status = unavailable();
  }

  process.stdout.write(`${JSON.stringify(status)}\n`);
  process.exitCode = status.available ? 0 : 1;
}

void main();

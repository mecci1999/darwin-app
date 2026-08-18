import { TrailsState } from '../types';
import { runOneTrailsPublicDerivativePublicationJob } from './public-derivative-publication-worker';
import { TencentCosStaticPublicDerivativeStore } from './tencent-cos-static-public-derivative-store';

const publicationEnabled = (environment: NodeJS.ProcessEnv): boolean => environment.TRAILS_MEDIA_PUBLICATION_ENABLED === 'true';

const workerInterval = (environment: NodeJS.ProcessEnv): number => {
  const value = environment.TRAILS_MEDIA_PUBLICATION_WORKER_INTERVAL_MS;
  if (value === undefined || value === '') return 15_000;
  if (!/^[0-9]+$/.test(value)) throw new Error('Trails publication worker interval is invalid');
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000 || milliseconds > 300_000) throw new Error('Trails publication worker interval is invalid');
  return milliseconds;
};

export interface TrailsPublicationWorkerLog {
  info(message: string): void;
  error(message: string): void;
}

/** Owns one durable publication worker in the single Trails deployment. */
export class TrailsPublicDerivativePublicationLifecycle {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly log: TrailsPublicationWorkerLog = console,
  ) {}

  start(state: TrailsState): void {
    if (!publicationEnabled(this.environment)) return;
    if (this.timer || this.running) throw new Error('Trails publication worker is already started');
    if (!state.publicDerivativePublicationJobStore || !state.durableMediaAssetRegistryStore) throw new Error('Trails publication worker dependencies are unavailable');

    const adapter = new TencentCosStaticPublicDerivativeStore(this.environment);
    const run = async (): Promise<void> => {
      if (this.running || this.stopped) return;
      this.running = (async () => {
        const result = await runOneTrailsPublicDerivativePublicationJob({
          jobs: state.publicDerivativePublicationJobStore!,
          privateLocatorResolver: adapter,
          credentialProvider: adapter,
          objectStore: adapter,
          registry: state.durableMediaAssetRegistryStore!,
          logger: {
            info: (event, details) => { if (event === 'published') this.log.info(`Trails public derivative published: ${details.jobId}`); },
            error: (_event, details) => this.log.error(`Trails public derivative publication failed: ${details.jobId || 'unknown'}`),
          },
        });
        if (result.outcome === 'failed') this.log.error(`Trails publication job marked failed: ${result.jobId}`);
      })().catch(() => this.log.error('Trails public derivative worker failed')).finally(() => { this.running = undefined; });
      await this.running;
    };

    void run();
    this.timer = setInterval(() => { void run(); }, workerInterval(this.environment));
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}

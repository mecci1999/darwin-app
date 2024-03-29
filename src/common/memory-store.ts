/**
 * 内存仓库
 */
export default class MemoryStore {
  public hits: Map<any, any>;
  public resetTime: number;
  public timer: any;

  constructor(clearPeriod: number) {
    this.hits = new Map();
    this.resetTime = Date.now() + clearPeriod;

    this.timer = setInterval(() => {
      this.resetTime = Date.now() + clearPeriod;
      this.reset();
    }, clearPeriod);

    this.timer.unref();
  }

  /**
   * Increment the counter by key
   */
  public inc(key: string): number {
    let counter = this.hits.get(key) || 0;
    counter++;
    this.hits.set(key, counter);

    return counter;
  }

  /**
   * Reset all counters
   */
  public reset() {
    this.hits.clear();
  }
}

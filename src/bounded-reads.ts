/** Limits both the number and maximum response bytes of concurrent host reads. */
export class BoundedReads {
  private active = 0;
  private bytes = 0;
  private waiting: { bytes: number; start(): void }[] = [];
  constructor(private concurrency: number, private byteLimit: number, private queueLimit = 64) {
    if (![concurrency, byteLimit, queueLimit].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid native read bounds.');
  }
  run<T>(bytes: number, work: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.byteLimit || this.waiting.length >= this.queueLimit) return Promise.reject(new Error('Native read queue exceeds its bound. Retry after current reads complete.'));
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ bytes, start: () => {
        this.active++; this.bytes += bytes;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => { this.active--; this.bytes -= bytes; this.drain(); });
      } });
      this.drain();
    });
  }
  private drain() {
    while (this.waiting.length && this.active < this.concurrency && this.bytes + this.waiting[0].bytes <= this.byteLimit) this.waiting.shift()!.start();
  }
}

/** Stop scheduling on cancellation/failure, drain active reads before cleanup. */
export async function mapReads<T, U>(items: readonly T[], concurrency: number, signal: AbortSignal, read: (item: T, index: number) => Promise<U>): Promise<U[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid read concurrency.');
  const results = new Array<U>(items.length); let next = 0, failure: { reason: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { signal.throwIfAborted(); results[index] = await read(items[index], index); signal.throwIfAborted(); }
      catch (reason) { failure ??= { reason }; }
    }
  }));
  signal.throwIfAborted();
  if (failure) throw failure.reason;
  return results;
}

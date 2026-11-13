import { boundedJSON, maxMetadataBytes } from './git-reads';
import { utf8Bytes } from './utf8';

export type ApiCooldown = { until: number; failures: number; scope: 'user' | 'global' };

export async function responseCooldown(response: Response, now: number, failures: number): Promise<ApiCooldown | undefined> {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
  const retry = response.headers.get('retry-after');
  const retryUntil = retry === null ? 0 : /^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  let secondary = response.status === 429 || Number.isFinite(retryUntil) && retryUntil > now;
  if (response.status === 403 && remaining !== '0' && !secondary) {
    try {
      const data = await boundedJSON(response, maxMetadataBytes) as { message?: unknown };
      secondary = typeof data.message === 'string' && /(?:secondary rate limit|rate limit exceeded|abuse detection)/i.test(data.message);
    } catch { /* A malformed permission error is not evidence of throttling. */ }
  }
  if (remaining !== '0' && !secondary) return;
  const backoff = 60000 * 2 ** Math.min(failures, 6);
  return {
    until: Math.max(now + (secondary ? backoff : 1000), Number.isFinite(reset) && remaining === '0' ? reset + 1000 : 0, Number.isFinite(retryUntil) ? retryUntil : 0,
      // Missing/stale reset headers still require a pause, not a hot loop.
      remaining === '0' && (!Number.isFinite(reset) || reset <= now) ? now + backoff : 0),
    failures: failures + 1, scope: secondary ? 'global' : 'user',
  };
}

// In-memory only, bounded and credential/installation scoped. Membership is
// still revalidated over HTTP before any cached Git object is returned.
export class ApiReadCache {
  constructor(private capacityBytes = 32 * 1024 * 1024) {}
  private entries = new Map<string, { value: unknown; etag?: string; bytes: number }>();
  private bytes = 0;
  get(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    return entry;
  }
  put(key: string, value: unknown, etag?: string) {
    this.remove(key);
    const bytes = utf8Bytes(JSON.stringify(value));
    if (bytes > this.capacityBytes) return;
    this.entries.set(key, { value, etag, bytes }); this.bytes += bytes;
    while (this.bytes > this.capacityBytes || this.entries.size > 256) this.remove(this.entries.keys().next().value!);
  }
  private remove(key: string) { const entry = this.entries.get(key); if (entry) this.bytes -= entry.bytes; this.entries.delete(key); }
  clearConnection(id: string) { for (const key of this.entries.keys()) if (key.startsWith(id + ':')) this.remove(key); }
}

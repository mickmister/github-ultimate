import { mutatePageKV, parsePageKVRequest, validatePageKV, type PageKVRequest, type PageKVSnapshot } from './page-kv';
export type PageStorageTransport = (request: PageKVRequest) => Promise<PageKVSnapshot>;
export type PageStorageBackend = 'browser' | 'extension' | 'mobile';
export interface PageStorageAdapter { protocolVersion: 1; backend: PageStorageBackend; request: PageStorageTransport }
declare global { interface Window { githubUltimateStorageAdapter?: PageStorageAdapter } }

/** Hydrate BEFORE app startup; synchronous methods read an optimistic mirror. */
export class HydratedPageStorage implements Storage {
  private state: PageKVSnapshot;
  private tail = Promise.resolve();
  private failure?: Error;
  private stopped = false;
  private refreshing = false;
  private constructor(private transport: PageStorageTransport, initial: PageKVSnapshot, private onError: (error: Error) => void) { this.state = validatePageKV(initial); }
  static async open(transport: PageStorageTransport, onError: (error: Error) => void = () => {}) {
    return new HydratedPageStorage(transport, await transport({ operation: 'kvSnapshot' }), onError);
  }
  get length() { return this.state.entries.length; }
  key(index: number) { return this.state.entries[Math.trunc(index) >>> 0]?.[0] ?? null; }
  getItem(key: string) { return new Map(this.state.entries).get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.write({ operation: 'kvSet', key: String(key), value: String(value) }); }
  removeItem(key: string) { this.write({ operation: 'kvRemove', key: String(key) }); }
  clear() { this.write({ operation: 'kvClear' }); }
  private write(request: PageKVRequest) {
    if (this.stopped || this.failure || this.refreshing) throw new Error('Page storage is unavailable or refreshing; reopen explicitly after failure.');
    const next = mutatePageKV(this.state, parsePageKVRequest(request));
    this.state = next;
    this.tail = this.tail.then(async () => {
      if (this.failure || this.stopped) return;
      try { await this.transport(request); }
      catch (cause) {
        this.failure = cause instanceof Error ? cause : new Error('Page storage write failed.');
        // Stop all queued writes after an ambiguous failure; never replay them
        // silently. The current mirror remains usable but is NOT durable proof.
        try { this.onError(this.failure); } catch { /* Error UI must not break queue handling. */ }
      }
    });
  }
  async flush() { await this.tail; if (this.failure) throw this.failure; if (this.stopped) throw new Error('Page storage closed.'); }
  async refresh() {
    if (this.refreshing) throw new Error('Page storage refresh already in progress.');
    this.refreshing = true;
    try { await this.flush(); const snapshot = await this.transport({ operation: 'kvSnapshot' }); if (!this.stopped) this.state = validatePageKV(snapshot); }
    finally { this.refreshing = false; }
  }
  close() { this.stopped = true; }
}

/** Explicit opt-in replacement, not per-method assignment on native Storage. */
export function overrideLocalStorage(page: Window, storage: HydratedPageStorage): () => void {
  const previous = Object.getOwnPropertyDescriptor(page, 'localStorage');
  Object.defineProperty(page, 'localStorage', { configurable: true, get: () => storage });
  const flush = () => { void storage.flush().catch(error => page.dispatchEvent(new CustomEvent('page-storage-error', { detail: String(error) }))); };
  page.addEventListener('pagehide', flush); page.document.addEventListener('visibilitychange', flush);
  return () => {
    storage.close(); page.removeEventListener('pagehide', flush); page.document.removeEventListener('visibilitychange', flush);
    if (previous) Object.defineProperty(page, 'localStorage', previous); else Reflect.deleteProperty(page, 'localStorage');
  };
}

/** Portable, string-valued page storage. Never a credential store. */
import { utf8Bytes as pageKVBytes } from './utf8';
export { pageKVBytes };
export const pageKVLimit = 64 * 1024;
export type PageKVSnapshot = { revision: number; entries: [string, string][] };
export type PageKVRequest = { operation: 'kvSnapshot' | 'kvClear' } | { operation: 'kvRemove'; key: string } | { operation: 'kvSet'; key: string; value: string };
export interface PageKVStore {
  transact(origin: string, change: (current: PageKVSnapshot) => PageKVSnapshot): Promise<PageKVSnapshot>;
}
export const emptyPageKV = (): PageKVSnapshot => ({ revision: 0, entries: [] });
export function parsePageKVRequest(input: unknown): PageKVRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid page storage request.');
  const data = input as Record<string, unknown>;
  const keys = data.operation === 'kvSet' ? ['operation', 'key', 'value'] : data.operation === 'kvRemove' ? ['operation', 'key'] : ['operation'];
  if (!['kvSnapshot', 'kvSet', 'kvRemove', 'kvClear'].includes(String(data.operation)) || Object.keys(data).some(key => !keys.includes(key))) throw new Error('Invalid page storage operation or fields.');
  if (keys.includes('key') && (typeof data.key !== 'string' || data.key.length > 256)) throw new Error('Storage keys must be strings of at most 256 characters.');
  if (keys.includes('value') && (typeof data.value !== 'string' || data.value.length > 4096)) throw new Error('Storage values must be strings of at most 4096 characters.');
  if (pageKVBytes(JSON.stringify(data)) > 12 * 1024) throw new Error('Encoded page storage request exceeds 12 KiB.');
  return data as PageKVRequest;
}
export function validatePageKV(value: PageKVSnapshot): PageKVSnapshot {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.entries) || value.entries.length > 128) throw new Error('Invalid or excessive page storage.');
  const keys = new Set<string>();
  for (const item of value.entries) {
    if (!Array.isArray(item) || item.length !== 2) throw new Error('Invalid page storage entry.');
    parsePageKVRequest({ operation: 'kvSet', key: item[0], value: item[1] });
    if (keys.has(item[0])) throw new Error('Duplicate page storage key.');
    keys.add(item[0]);
  }
  if (JSON.stringify(value.entries).length * 2 > pageKVLimit) throw new Error('Page storage exceeds the 64 KiB quota.');
  return { revision: value.revision, entries: value.entries.map(([key, text]) => [key, text]) };
}
export function mutatePageKV(current: PageKVSnapshot, request: PageKVRequest): PageKVSnapshot {
  validatePageKV(current);
  if (request.operation === 'kvSnapshot') return current;
  const values = new Map(current.entries);
  if (request.operation === 'kvSet') values.set(request.key, request.value);
  if (request.operation === 'kvRemove') values.delete(request.key);
  if (request.operation === 'kvClear') values.clear();
  return validatePageKV({ revision: current.revision + 1, entries: [...values] });
}
export function pageKVOrigin(documentURL: string): string {
  const url = new URL(documentURL);
  if (url.username || url.password || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Page storage requires HTTPS (or development loopback).');
  return url.origin;
}
export class PageKVService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: PageKVStore, private allowed: (originalDocumentURL: string) => boolean | Promise<boolean>) {}
  request(originalDocumentURL: string, input: unknown, isCurrent: () => boolean = () => true): Promise<PageKVSnapshot> {
    const request = parsePageKVRequest(input);
    const work = this.tail.catch(() => {}).then(async () => {
      if (!isCurrent() || !await this.allowed(originalDocumentURL) || !isCurrent()) throw new Error('Page storage is not approved for this document.');
      const origin = pageKVOrigin(originalDocumentURL); // NEVER from page params.
      const result = await this.store.transact(origin, current => {
        if (!isCurrent()) throw new Error('Page storage document changed before persistence.');
        return mutatePageKV(current, request);
      });
      if (!isCurrent() || !await this.allowed(originalDocumentURL) || !isCurrent()) throw new Error('Page storage access changed during this request.');
      return validatePageKV(result);
    });
    this.tail = work;
    return work;
  }
}

/** Adapter for React Native AsyncStorage; a dedicated prefix prevents collisions. */
export class AsyncPageKVStore implements PageKVStore {
  constructor(private storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }) {}
  async transact(origin: string, change: (current: PageKVSnapshot) => PageKVSnapshot) {
    const key = `github-ultimate:page-kv:v1:${encodeURIComponent(origin)}`;
    const raw = await this.storage.getItem(key);
    const current = raw === null ? emptyPageKV() : validatePageKV(JSON.parse(raw));
    const next = change(current);
    if (next !== current) await this.storage.setItem(key, JSON.stringify(next));
    return next;
  }
}

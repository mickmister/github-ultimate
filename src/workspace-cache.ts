import type { CacheSettingsService } from './cache-settings';
import { pageKVBytes } from './page-kv';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type CacheNamespace = 'documents' | 'dolt' | 'metadata';
export interface CacheScope { connection: string; account: number; installation: number; generation?: number | string; repository: string; workspace: string; namespace: CacheNamespace }
export interface CacheMetadata { key: string; scope: string; connection: string; namespace: CacheNamespace; visitedAt: number; bytes: number; digest: string }
export interface CacheEntry extends CacheMetadata { value: unknown }
// All cache payloads are JSON API values. Hermes need not provide structuredClone.
export function copyCacheValue<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
const metadataSchema = z.object({ key: z.string(), scope: z.string(), connection: z.string(), namespace: z.enum(['documents', 'dolt', 'metadata']), visitedAt: z.number().finite().nonnegative(), bytes: z.number().int().nonnegative(), digest: z.string().regex(/^[a-f0-9]{64}$/) });
function digest(value: unknown) {
  // Hash exact JSON UTF-16 code units in bounded chunks, including on Hermes
  // runtimes without TextEncoder. This is a local checksum, not a Git OID.
  const text = JSON.stringify(value), hash = sha256.create();
  for (let offset = 0; offset < text.length; offset += 4096) {
    const chunk = new Uint8Array(Math.min(4096, text.length - offset) * 2);
    for (let index = 0; index < chunk.length / 2; index++) { const code = text.charCodeAt(offset + index); chunk[index * 2] = code & 255; chunk[index * 2 + 1] = code >>> 8; }
    hash.update(chunk);
  }
  return bytesToHex(hash.digest());
}
export interface WorkspaceCacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  list(): Promise<CacheMetadata[]>;
  // Replacement and eviction are one transaction, never a partially updated index.
  write(entry: CacheEntry | undefined, remove: string[]): Promise<void>;
}
export const cacheScopeKey = (scope: CacheScope) => JSON.stringify([1, scope.connection, scope.account, scope.installation, scope.generation ?? 0, scope.repository.toLowerCase(), scope.workspace, scope.namespace]);

/** Read-through foundation, not a claim of complete/offline workspace snapshots. */
export class WorkspaceCache {
  private tail: Promise<unknown> = Promise.resolve();
  private failure = '';
  constructor(private store: WorkspaceCacheStore, readonly settings: CacheSettingsService, private now = () => Date.now()) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(work); this.tail = result; return result;
  }
  private key(scope: CacheScope, resource: string) { return JSON.stringify([cacheScopeKey(scope), resource]); }
  private async list() { return z.array(metadataSchema).parse(await this.store.list()); }
  async get(scope: CacheScope, resource: string, visit = false) {
    return this.serial(async () => {
      try {
        if (scope.namespace === 'dolt' && !(await this.settings.read()).cacheDolt) return;
        const entry = await this.store.get(this.key(scope, resource));
        if (!entry || !metadataSchema.safeParse(entry).success || entry.key !== this.key(scope, resource) || entry.scope !== cacheScopeKey(scope) || entry.connection !== scope.connection) return;
        if (entry.digest !== digest(entry.value)) { await this.store.write(undefined, [entry.key]); this.failure = 'A corrupt cached read was discarded; it will be fetched again.'; return; }
        if (visit) await this.store.write({ ...entry, visitedAt: this.now() }, []);
        return copyCacheValue(entry.value);
      } catch { this.failure = 'Persistent cache is unavailable. Network reads remain available.'; return; }
    });
  }
  async put(scope: CacheScope, resource: string, value: unknown) {
    return this.serial(async () => {
      try {
        const settings = await this.settings.read();
        if (scope.namespace === 'dolt' && !settings.cacheDolt) return;
        const key = this.key(scope, resource), scopeKey = cacheScopeKey(scope), entries = await this.list();
        const existing = entries.filter(entry => entry.scope === scopeKey);
        const entry: CacheEntry = { key, scope: scopeKey, connection: scope.connection, namespace: scope.namespace,
          visitedAt: Math.max(0, ...existing.map(entry => entry.visitedAt)) || this.now(), bytes: 0, digest: digest(value), value: copyCacheValue(value) };
        // Include the separate metadata index and key, not just raw payload size.
        let previous = -1;
        while (previous !== entry.bytes) { previous = entry.bytes; const { value: _, ...metadata } = entry; entry.bytes = pageKVBytes(JSON.stringify(entry)) + pageKVBytes(JSON.stringify(metadata)) + pageKVBytes(key); }
        if (entry.bytes > settings.capacityMiB * 1024 * 1024) { this.failure = 'This object exceeds cache capacity; it was read but not persisted.'; return; }
        const all = [...entries.filter(item => item.key !== key), entry];
        const remove = this.evictions(all, settings, scopeKey);
        if (remove === undefined) { this.failure = 'Workspace cache capacity reached. This read was not persisted.'; return; }
        await this.store.write(entry, remove);
        this.failure = '';
      } catch { this.failure = 'Cache persistence failed. Displayed data may not survive restart.'; }
    });
  }
  private evictions(entries: CacheMetadata[], settings: Awaited<ReturnType<CacheSettingsService['read']>>, protectedScope?: string) {
    const groups = new Map<string, { entries: CacheMetadata[]; visited: number; namespace: CacheNamespace }>();
    for (const entry of entries) {
      const group = groups.get(entry.scope) ?? { entries: [], visited: 0, namespace: entry.namespace };
      group.entries.push(entry); group.visited = Math.max(group.visited, entry.visitedAt); groups.set(entry.scope, group);
    }
    let bytes = entries.reduce((sum, item) => sum + item.bytes, 0);
    const count = (namespace: CacheNamespace) => [...groups.values()].filter(group => group.namespace === namespace).length;
    const exceeds = () => bytes > settings.capacityMiB * 1024 * 1024 || count('documents') > settings.documentWorkspaces || count('dolt') > (settings.cacheDolt ? settings.doltWorkspaces : 0);
    const removed: string[] = [];
    for (const [scope, group] of [...groups].sort((a, b) => (!settings.cacheDolt ? Number(b[1].namespace === 'dolt') - Number(a[1].namespace === 'dolt') : 0) || a[1].visited - b[1].visited || a[0].localeCompare(b[0]))) {
      if (!exceeds()) break;
      if (scope === protectedScope) continue;
      const overKind = count(group.namespace) > (group.namespace === 'documents' ? settings.documentWorkspaces : group.namespace === 'dolt' ? settings.cacheDolt ? settings.doltWorkspaces : 0 : Infinity);
      if (!overKind && bytes <= settings.capacityMiB * 1024 * 1024) continue;
      removed.push(...group.entries.map(entry => entry.key)); bytes -= group.entries.reduce((sum, entry) => sum + entry.bytes, 0); groups.delete(scope);
    }
    return exceeds() ? undefined : removed;
  }
  async trim() {
    return this.serial(async () => {
      try { const remove = this.evictions(await this.list(), await this.settings.read()); if (remove) await this.store.write(undefined, remove); }
      catch { this.failure = 'Settings saved, but cache eviction failed. Existing bytes may exceed the new limits.'; }
    });
  }
  async clearConnection(connection: string) {
    return this.serial(async () => { await this.store.write(undefined, (await this.store.list()).filter(entry => entry.connection === connection).map(entry => entry.key)); });
  }
  async remove(scope: CacheScope, resource: string) { return this.serial(() => this.store.write(undefined, [this.key(scope, resource)])); }
  async status() {
    await this.tail.catch(() => {});
    try {
      const entries = await this.list();
      return { bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries: entries.length,
        documentWorkspaces: new Set(entries.filter(entry => entry.namespace === 'documents').map(entry => entry.scope)).size,
        doltWorkspaces: new Set(entries.filter(entry => entry.namespace === 'dolt').map(entry => entry.scope)).size,
        error: this.failure, completeSnapshots: false as const };
    } catch { return { bytes: 0, entries: 0, documentWorkspaces: 0, doltWorkspaces: 0, error: 'Cache storage is unavailable.', completeSnapshots: false as const }; }
  }
}

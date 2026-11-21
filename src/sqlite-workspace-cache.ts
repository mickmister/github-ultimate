import type { CacheEntry, CacheMetadata, WorkspaceCacheStore } from './workspace-cache';

// Structural interface keeps Expo native modules out of browser builds/tests.
export interface CacheDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
  getAllAsync<T>(sql: string): Promise<T[]>;
  runAsync(sql: string, ...params: string[]): Promise<unknown>;
  withExclusiveTransactionAsync(work: (transaction: Pick<CacheDatabase, 'runAsync'>) => Promise<void>): Promise<void>;
}
export class SQLiteWorkspaceCacheStore implements WorkspaceCacheStore {
  private ready: Promise<CacheDatabase>;
  constructor(database: Promise<CacheDatabase>) {
    this.ready = database.then(async db => { await db.execAsync('CREATE TABLE IF NOT EXISTS workspace_cache_v1 (key TEXT PRIMARY KEY, metadata TEXT NOT NULL, value TEXT NOT NULL)'); return db; });
    void this.ready.catch(() => {});
  }
  async get(key: string): Promise<CacheEntry | undefined> {
    const row = await (await this.ready).getFirstAsync<{ metadata: string; value: string }>('SELECT metadata, value FROM workspace_cache_v1 WHERE key = ?', key);
    return row ? { ...JSON.parse(row.metadata), value: JSON.parse(row.value) } : undefined;
  }
  async list(): Promise<CacheMetadata[]> { return (await (await this.ready).getAllAsync<{ metadata: string }>('SELECT metadata FROM workspace_cache_v1')).map(row => JSON.parse(row.metadata)); }
  async write(entry: CacheEntry | undefined, remove: string[]) {
    await (await this.ready).withExclusiveTransactionAsync(async transaction => {
      for (const key of remove) await transaction.runAsync('DELETE FROM workspace_cache_v1 WHERE key = ?', key);
      if (entry) {
        const { value, ...metadata } = entry;
        await transaction.runAsync('INSERT OR REPLACE INTO workspace_cache_v1 (key, metadata, value) VALUES (?, ?, ?)', entry.key, JSON.stringify(metadata), JSON.stringify(value));
      }
    });
  }
}

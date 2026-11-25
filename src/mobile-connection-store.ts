import type { ConnectionRecord, ConnectionStore } from './connections';
import { pageKVBytes } from './page-kv';
import { z } from 'zod';

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Vault = Storage & { removeItem(key: string): Promise<void> };
type Metadata = Omit<ConnectionRecord, 'tokens' | 'pending'> & { secretKey?: string };
const indexKey = 'alohak:github-connections:v1';
const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id);
const credentials = z.object({
  tokens: z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1).optional(), expiresAt: z.number().finite(), refreshExpiresAt: z.number().finite().optional() }).strict().optional(),
  pending: z.object({ deviceCode: z.string().min(1), userCode: z.string().min(1), expiresAt: z.number().finite(), interval: z.number().positive(), nextPollAt: z.number().finite() }).strict().optional(),
}).strict();

/** Only the native host holds this store. Tokens/device codes never enter AsyncStorage. */
export class MobileConnectionStore implements ConnectionStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private metadata: Storage, private vault: Vault, private newId: () => string) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(work); this.tail = result; return result;
  }
  private async records(): Promise<Metadata[]> {
    const raw = await this.metadata.getItem(indexKey);
    if (raw === null) return [];
    const data: Metadata[] = JSON.parse(raw);
    if (!Array.isArray(data) || data.some(record => !record || !validId(record.id) || 'tokens' in record || 'pending' in record || record.secretKey !== undefined && (!/^alohak\.github\.[a-f0-9-]{36}\.[a-f0-9-]{36}$/i.test(record.secretKey) || !record.secretKey.startsWith(`alohak.github.${record.id}.`))) || new Set(data.map(record => record.id)).size !== data.length) throw new Error('Native connection metadata is invalid.');
    return data;
  }
  private async hydrate(record: Metadata): Promise<ConnectionRecord> {
    const { secretKey, ...publicData } = record;
    if (!secretKey) return publicData;
    const raw = await this.vault.getItem(secretKey);
    // A restored Android backup can retain metadata without its keystore key.
    // Keep the public connection but require sign-in and fresh grants.
    if (raw === null) return { ...publicData, hostedGrants: [], origins: [], user: undefined, installation: undefined, recentNavigation: [] };
    if (pageKVBytes(raw) > 1800) throw new Error('Native connection credentials are invalid.');
    const secret = credentials.safeParse(JSON.parse(raw));
    if (!secret.success) throw new Error('Native connection credentials are invalid.');
    return { ...publicData, ...secret.data };
  }
  all() { return this.serial(async () => Promise.all((await this.records()).map(record => this.hydrate(record)))); }
  get(id: string) { return this.serial(async () => { const record = (await this.records()).find(record => record.id === id); return record && this.hydrate(record); }); }
  put(record: ConnectionRecord) {
    return this.serial(async () => {
      if (!validId(record.id)) throw new Error('Invalid native connection ID.');
      const records = await this.records(), previous = records.find(item => item.id === record.id);
      const { tokens, pending, ...publicData } = record;
      const next: Metadata = { ...publicData };
      if (tokens || pending) {
        const parsed = credentials.safeParse({ tokens, pending });
        if (!parsed.success) throw new Error('Native connection credentials are invalid.');
        const secret = JSON.stringify(parsed.data);
        // GitHub device-flow credentials fit within the portable SecureStore
        // per-item budget. Reject excessive issuer responses; never downgrade.
        if (pageKVBytes(secret) > 1800) throw new Error('GitHub credentials exceed secure storage limits. Sign in again.');
        next.secretKey = `alohak.github.${record.id}.${this.newId()}`;
        await this.vault.setItem(next.secretKey, secret);
      }
      try { await this.metadata.setItem(indexKey, JSON.stringify([...records.filter(item => item.id !== record.id), next])); }
      catch {
        if (next.secretKey) await this.vault.removeItem(next.secretKey).catch(() => {});
        throw new Error('Could not commit native connection state. Reconnect explicitly.');
      }
      // The metadata pointer is committed only after its complete secret. Old
      // generations are unreachable even if OS cleanup temporarily fails.
      if (previous?.secretKey) await this.vault.removeItem(previous.secretKey).catch(() => {});
    });
  }
  remove(id: string) {
    return this.serial(async () => {
      const records = await this.records(), previous = records.find(record => record.id === id);
      await this.metadata.setItem(indexKey, JSON.stringify(records.filter(record => record.id !== id)));
      if (previous?.secretKey) await this.vault.removeItem(previous.secretKey).catch(() => {});
    });
  }
}

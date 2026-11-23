import type { z } from 'zod';
import { utf8Bytes } from './utf8';
type MetadataStore = { getItem(key: string): Promise<string | null>; setItem(key: string, text: string): Promise<void> };
type Vault = MetadataStore & { removeItem(key: string): Promise<void> };
type RecordBase = { id: string };
type Saved = { id: string; public: Record<string, unknown>; secrets: string[] };
/** Generation pointers commit after all secure chunks. No credential field is
 * written to AsyncStorage, including user-marked plaintext inference headers. */
export class MobilePiStore<T extends RecordBase> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private kind: 'inference' | 's3', private metadata: MetadataStore, private vault: Vault, private newId: () => string, private schema: z.ZodType<T>, private secretFields: string[]) {}
  private serial<R>(work: () => Promise<R>) { const next = this.tail.catch(() => {}).then(work); this.tail = next; return next; }
  private async records(): Promise<Saved[]> {
    const records: Saved[] = JSON.parse(await this.metadata.getItem(`alohak:pi:${this.kind}:v1`) ?? '[]');
    if (!Array.isArray(records) || records.some(item => !/^[a-f0-9-]{36}$/i.test(item.id) || !item.public || this.secretFields.some(key => key in item.public) || !Array.isArray(item.secrets) || !item.secrets.length || item.secrets.length > 64 || item.secrets.some(key => !new RegExp(`^alohak\\.pi\\.${this.kind}\\.${item.id}\\.[a-f0-9-]{36}\\.\\d+$`, 'i').test(key))) || new Set(records.map(item => item.id)).size !== records.length) throw Error('Native Pi connection metadata is invalid.');
    return records;
  }
  private async hydrate(record: Saved) {
    const parts = await Promise.all(record.secrets.map(key => this.vault.getItem(key)));
    if (parts.some(part => part === null)) throw Error('Unlock the device or reconnect the native Pi credentials.');
    try { return this.schema.parse({ ...record.public, ...JSON.parse(parts.join('')) }); }
    catch { throw Error('Native Pi credentials are unavailable. Reconnect in native settings.'); }
  }
  all() { return this.serial(async () => Promise.all((await this.records()).map(record => this.hydrate(record)))); }
  get(id: string) { return this.serial(async () => { const record = (await this.records()).find(item => item.id === id); return record && this.hydrate(record); }); }
  put(input: T) { return this.serial(async () => {
    const record = this.schema.parse(input), records = await this.records(), previous = records.find(item => item.id === record.id);
    const data = { ...record } as Record<string, unknown>, secret: Record<string, unknown> = {};
    for (const field of this.secretFields) { if (field in data) secret[field] = data[field]; delete data[field]; }
    const text = JSON.stringify(secret), parts: string[] = [];
    // Split by Unicode code point and actual UTF-8 bytes for portable vault items.
    let part = '', bytes = 0;
    for (const character of text) { const size = utf8Bytes(character); if (bytes + size > 1600) { parts.push(part); part = ''; bytes = 0; } part += character; bytes += size; }
    if (part) parts.push(part);
    if (!parts.length || parts.length > 64) throw Error('Pi credentials exceed native secure-storage limits.');
    const generation = this.newId(), secrets = parts.map((_, index) => `alohak.pi.${this.kind}.${record.id}.${generation}.${index}`);
    try {
      for (let index = 0; index < parts.length; index++) await this.vault.setItem(secrets[index], parts[index]);
      await this.metadata.setItem(`alohak:pi:${this.kind}:v1`, JSON.stringify([...records.filter(item => item.id !== record.id), { id: record.id, public: data, secrets }]));
    } catch { await Promise.all(secrets.map(key => this.vault.removeItem(key).catch(() => {}))); throw Error('Could not commit native Pi settings.'); }
    if (previous) await Promise.all(previous.secrets.map(key => this.vault.removeItem(key).catch(() => {})));
  }); }
  remove(id: string) { return this.serial(async () => {
    const records = await this.records(), previous = records.find(item => item.id === id);
    await this.metadata.setItem(`alohak:pi:${this.kind}:v1`, JSON.stringify(records.filter(item => item.id !== id)));
    if (previous) await Promise.all(previous.secrets.map(key => this.vault.removeItem(key).catch(() => {})));
  }); }
}

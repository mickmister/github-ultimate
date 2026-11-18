import { z } from 'zod';
import type { VdStore, VdRecord } from './vd-connections';
import type { ReviewReceipt } from './review-protocol';
import { utf8Bytes } from './utf8';

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Vault = Storage & { removeItem(key: string): Promise<void> };
type Metadata = Omit<VdRecord, 'headers'> & { secretKey: string };
const index = 'alohak:vd-connections:v1';
const headerSchema = z.array(z.object({ name: z.string(), mode: z.enum(['plaintext', 'secret']), value: z.string() }).strict());
/** Headers (including plaintext-mode values) never enter native AsyncStorage. */
export class MobileVdStore implements VdStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private metadata: Storage, private vault: Vault, private newId: () => string) {}
  private serial<T>(work: () => Promise<T>) { const next = this.tail.catch(() => {}).then(work); this.tail = next; return next; }
  private async records(): Promise<Metadata[]> {
    const records: Metadata[] = JSON.parse(await this.metadata.getItem(index) ?? '[]');
    if (!Array.isArray(records) || records.some(item => !/^[a-f0-9-]{36}$/i.test(item.id) || 'headers' in item || !item.secretKey?.startsWith(`alohak.vd.${item.id}.`))) throw new Error('VD connection metadata is unavailable.');
    return records;
  }
  private async hydrate(record: Metadata): Promise<VdRecord> {
    const { secretKey, ...data } = record;
    const raw = await this.vault.getItem(secretKey);
    if (raw === null) throw new Error('Unlock the device or reconnect the VD credentials.');
    try { return { ...data, headers: headerSchema.parse(JSON.parse(raw)) }; }
    catch { throw new Error('Could not read native VD credentials. Reconnect in settings.'); }
  }
  all() { return this.serial(async () => Promise.all((await this.records()).map(record => this.hydrate(record)))); }
  get(id: string) { return this.serial(async () => { const record = (await this.records()).find(item => item.id === id); return record && this.hydrate(record); }); }
  put(record: VdRecord) { return this.serial(async () => {
    const records = await this.records(), previous = records.find(item => item.id === record.id);
    const { headers, ...data } = record, secret = JSON.stringify(headers);
    if (utf8Bytes(secret) > 1800) throw new Error('VD headers exceed the portable secure-storage limit.');
    const secretKey = `alohak.vd.${record.id}.${this.newId()}`;
    await this.vault.setItem(secretKey, secret);
    try { await this.metadata.setItem(index, JSON.stringify([...records.filter(item => item.id !== record.id), { ...data, secretKey }])); }
    catch { await this.vault.removeItem(secretKey).catch(() => {}); throw new Error('Could not commit VD settings.'); }
    if (previous) await this.vault.removeItem(previous.secretKey).catch(() => {});
  }); }
  remove(id: string) { return this.serial(async () => {
    const records = await this.records(), previous = records.find(item => item.id === id);
    await this.metadata.setItem(index, JSON.stringify(records.filter(item => item.id !== id)));
    if (previous) await this.vault.removeItem(previous.secretKey).catch(() => {});
  }); }
  async delivery(key: string): Promise<ReviewReceipt | undefined> { const text = await this.metadata.getItem(`alohak:vd-delivery:${key}`); return text ? JSON.parse(text) : undefined; }
  async saveDelivery(key: string, receipt: ReviewReceipt) { await this.metadata.setItem(`alohak:vd-delivery:${key}`, JSON.stringify(receipt)); }
}

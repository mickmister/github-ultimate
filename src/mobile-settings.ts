import { deploymentURL } from './mobile-protocol';
import { z } from 'zod';

const key = 'alohak:deployment:v1';
const schema = z.object({ entryURL: z.string(), fixtureApproved: z.boolean(), storageApproved: z.boolean() }).strict();
export type MobileSettings = z.infer<typeof schema>;
type Store = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export class MobileSettingsStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: Store) {}
  async load(): Promise<MobileSettings | undefined> {
    const raw = await this.store.getItem(key);
    if (raw === null) return undefined;
    const value = schema.parse(JSON.parse(raw));
    return { ...value, entryURL: deploymentURL(value.entryURL).href };
  }
  save(input: MobileSettings) {
    const value = schema.parse(input);
    const settings = { ...value, entryURL: deploymentURL(value.entryURL).href };
    const result = this.tail.catch(() => {}).then(() => this.store.setItem(key, JSON.stringify(settings)));
    this.tail = result; return result;
  }
}

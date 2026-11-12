import { z } from 'zod';

// One device-local contract; UI and persistence adapters do not choose defaults.
export const cacheSettingsSchema = z.object({
  version: z.literal(1).default(1),
  cacheDolt: z.boolean().default(true),
  documentWorkspaces: z.number().int().min(1).max(1000).default(10),
  doltWorkspaces: z.number().int().min(1).max(1000).default(10),
  capacityMiB: z.number().int().min(1).max(10240).default(100),
}).strict();
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;
export const defaultCacheSettings = (): CacheSettings => cacheSettingsSchema.parse({});
export const cacheSettingsKey = 'github-ultimate:workspace-cache-settings:v1';
export const cacheSettingFields = [
  { key: 'documentWorkspaces', label: 'Cached Documents workspaces', min: 1, max: 1000 },
  { key: 'doltWorkspaces', label: 'Cached Dolt workspaces', min: 1, max: 1000 },
  { key: 'capacityMiB', label: 'Total cache capacity (MiB)', min: 1, max: 10240 },
] as const;
export interface SettingsStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export class CacheSettingsService {
  constructor(private storage: SettingsStorage) {}
  async read() {
    const raw = await this.storage.getItem(cacheSettingsKey);
    return raw === null ? defaultCacheSettings() : cacheSettingsSchema.parse(JSON.parse(raw));
  }
  async save(input: unknown) {
    const settings = cacheSettingsSchema.parse(input);
    await this.storage.setItem(cacheSettingsKey, JSON.stringify(settings));
    return settings;
  }
}

export const defaults = { enabled: true, inlineForms: true, rememberDrafts: true };
export type Settings = typeof defaults;
export async function read<T>(key: string, fallback: T): Promise<T> {
  try { const data = await chrome.storage.local.get(key); return data[key] as T ?? fallback; } catch { return fallback; }
}
export async function write(key: string, value: unknown): Promise<void> { await chrome.storage.local.set({ [key]: value }); }
export async function settings(): Promise<Settings> { return { ...defaults, ...await read<Partial<Settings>>('settings', {}) }; }

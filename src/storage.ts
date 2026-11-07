import { extensionAPI } from './extension-api';

export const defaults = { enabled: true, inlineForms: true, rememberDrafts: true };
export type Settings = typeof defaults;
export async function read<T>(key: string, fallback: T): Promise<T> {
  try { const data = await extensionAPI().storage.local.get(key); return data[key] as T ?? fallback; } catch { return fallback; }
}
let pendingWrite: Promise<void> = Promise.resolve();
export function write(key: string, value: unknown): Promise<void> {
  // Snapshot now, and serialize writes so an older in-flight save cannot win.
  const snapshot = structuredClone(value);
  const result = pendingWrite.catch(() => {}).then(() => extensionAPI().storage.local.set({ [key]: snapshot }));
  pendingWrite = result;
  return result;
}
export async function settings(): Promise<Settings> { return { ...defaults, ...await read<Partial<Settings>>('settings', {}) }; }

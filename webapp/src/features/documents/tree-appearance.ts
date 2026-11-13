import { applicationStorage } from '../../app-storage';

export interface TreeAppearance {
  readonly density: 'comfortable' | 'compact';
  readonly accent: 'default' | 'blue' | 'teal';
}
export const defaultTreeAppearance: TreeAppearance = Object.freeze({ density: 'comfortable', accent: 'default' });
const key = 'github-ultimate:document-tree-appearance:v1';
export async function readTreeAppearance(): Promise<TreeAppearance> {
  try {
    const value = JSON.parse((await applicationStorage()).getItem(key) ?? 'null');
    if (value && ['comfortable', 'compact'].includes(value.density) && ['default', 'blue', 'teal'].includes(value.accent)) {
      return { density: value.density, accent: value.accent };
    }
  } catch { /* Browsing also works without browser storage. */ }
  return defaultTreeAppearance;
}
export async function saveTreeAppearance(value: TreeAppearance) {
  try { const storage = await applicationStorage(); storage.setItem(key, JSON.stringify(value)); await storage.flush(); } catch { /* Preferences remain usable for this tab. */ }
}

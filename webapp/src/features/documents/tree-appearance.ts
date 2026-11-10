export interface TreeAppearance {
  readonly density: 'comfortable' | 'compact';
  readonly accent: 'default' | 'blue' | 'teal';
}
export const defaultTreeAppearance: TreeAppearance = Object.freeze({ density: 'comfortable', accent: 'default' });
const key = 'github-ultimate:document-tree-appearance:v1';
export function readTreeAppearance(): TreeAppearance {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && ['comfortable', 'compact'].includes(value.density) && ['default', 'blue', 'teal'].includes(value.accent)) {
      return { density: value.density, accent: value.accent };
    }
  } catch { /* Browsing also works without browser storage. */ }
  return defaultTreeAppearance;
}
export function saveTreeAppearance(value: TreeAppearance) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences remain usable for this tab. */ }
}

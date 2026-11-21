import { z } from 'zod';
import { extensionAPI } from './extension-api';
import { utf8Bytes } from './utf8';

export const customizationKey = 'github-ultimate:customization:v1';
export const tokenNames = ['background', 'surface', 'text', 'muted', 'border', 'accent', 'selected', 'error', 'fontFamily', 'fontSize', 'lineHeight', 'radius', 'spacing', 'controlSize', 'contentWidth', 'sidebarWidth'] as const;
const schema = z.object({
  format: z.literal('github-ultimate-customization'), version: z.literal(1), name: z.string().max(80),
  mode: z.enum(['system', 'light', 'dark']), tokens: z.partialRecord(z.enum(tokenNames), z.string().min(1).max(256).refine(value => !/[;{}<>\x00-\x1f]/.test(value), 'Expected one CSS value')),
  css: z.string().max(128 * 1024),
}).strict();
export type Customization = z.infer<typeof schema>;
export const defaultCustomization = (): Customization => ({ format: 'github-ultimate-customization', version: 1, name: 'Default', mode: 'system', tokens: {}, css: '' });
export function parseCustomization(value: unknown): Customization {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof encoded !== 'string') throw new Error('Expected a customization JSON object.');
  if (utf8Bytes(encoded) > 256 * 1024) throw new Error('Customization JSON exceeds 256 KiB.');
  if (typeof value === 'string') value = JSON.parse(value);
  return schema.parse(value);
}
const palette = {
  light: { background: '#f5f7fb', surface: '#fff', text: '#19283d', muted: '#53647b', border: '#d6deeb', accent: '#4e38bd', selected: '#f0edff', error: '#a01d32' },
  dark: { background: '#101724', surface: '#182233', text: '#e4ebf6', muted: '#aabbd1', border: '#35445c', accent: '#bdadff', selected: '#302a4e', error: '#ffabb9' },
};
export function resolvedCustomizationTokens(value: Customization, systemMode: 'light' | 'dark' = 'light') {
  return { ...palette[value.mode === 'system' ? systemMode : value.mode], ...value.tokens };
}
const variables: Record<typeof tokenNames[number], string[]> = {
  background: ['--bg'], surface: ['--panel', '--surface'], text: ['--fg'], muted: ['--muted'], border: ['--line', '--border'], accent: ['--accent'], selected: ['--selected', '--accent-soft'], error: ['--error'],
  fontFamily: ['--ui-font-family'], fontSize: ['--ui-font-size'], lineHeight: ['--ui-line-height'], radius: ['--ui-radius'], spacing: ['--ui-spacing'], controlSize: ['--ui-control-size'], contentWidth: ['--ui-content-width'], sidebarWidth: ['--ui-sidebar-width'],
};
const properties: Record<typeof tokenNames[number], string> = { background: 'color', surface: 'color', text: 'color', muted: 'color', border: 'color', accent: 'color', selected: 'color', error: 'color', fontFamily: 'font-family', fontSize: 'font-size', lineHeight: 'line-height', radius: 'border-radius', spacing: 'padding', controlSize: 'min-height', contentWidth: 'width', sidebarWidth: 'width' };
export function customizationCSS(value: Customization, selector = ':root') {
  const tokens = { ...(value.mode === 'system' ? {} : palette[value.mode]), ...value.tokens };
  const declarations = Object.entries(tokens).flatMap(([key, token]) => {
    const name = key as typeof tokenNames[number];
    if (typeof CSS !== 'undefined' && !CSS.supports(properties[name], token)) throw new Error(`Invalid CSS value for ${name}.`);
    return variables[name].map(variable => `${variable}:${token};`);
  }).join('');
  const target = selector === ':host' ? ':host, :host([data-theme])' : selector;
  return `${target}{${value.mode === 'system' ? '' : `color-scheme:${value.mode};`}${declarations}}\n${value.css}`;
}
interface Store { read(): Promise<string | null>; write(value: string): Promise<void> }
const deviceStore: Store = {
  async read() {
    let api; try { api = extensionAPI(); } catch { return localStorage.getItem(customizationKey); }
    const stored = (await api.storage.local.get(customizationKey))[customizationKey];
    if (stored == null) return null;
    if (typeof stored !== 'string') throw new Error('Saved customization must be JSON text.');
    return stored;
  },
  async write(value) {
    let api; try { api = extensionAPI(); } catch { localStorage.setItem(customizationKey, value); return; }
    await api.storage.local.set({ [customizationKey]: value });
  },
};
export function createCustomization(initialStore: Store = deviceStore) {
  let store = initialStore, value = defaultCustomization(), saved = value, revision = 0, generation = 0, opening: Promise<void> | undefined;
  let writing: Promise<void> = Promise.resolve();
  const write = (operation: () => Promise<void>) => writing = writing.catch(() => {}).then(operation);
  const listeners = new Set<() => void>(), styles = new Set<WeakRef<HTMLStyleElement>>();
  function render() {
    for (const ref of styles) {
      const style = ref.deref();
      if (!style) { styles.delete(ref); continue; }
      style.textContent = customizationCSS(value, style.getRootNode() instanceof ShadowRoot ? ':host' : ':root');
    }
    revision++; for (const listener of listeners) listener();
  }
  const api = {
    configure(next: Store) { if (!opening) store = next; },
    ready() {
      if (!opening) {
        const token = generation;
        opening = store.read().then(text => { if (generation !== token) return; if (text) saved = value = parseCustomization(text); render(); }).catch(error => { if (generation === token) opening = undefined; throw error; });
      }
      return opening;
    },
    get: () => structuredClone(value),
    getSaved: () => structuredClone(saved),
    export: () => JSON.stringify(value, null, 2) + '\n',
    async apply(input: unknown) {
      const token = generation;
      await api.ready(); const next = parseCustomization(input); customizationCSS(next);
      if (generation !== token) return;
      await write(async () => { await store.write(JSON.stringify(next)); if (generation === token) { saved = value = next; render(); } });
    },
    async preview(input: unknown) { await api.ready(); const next = parseCustomization(input); customizationCSS(next); value = next; render(); },
    cancelPreview() { value = saved; render(); },
    async reset() {
      // Recovery must work even if the saved file is invalid or custom CSS hides UI.
      const token = ++generation;
      value = defaultCustomization(); opening = Promise.resolve(); render();
      await write(async () => {
        await store.write(JSON.stringify(defaultCustomization()));
        if (generation === token) { saved = defaultCustomization(); render(); }
      });
    },
    import: (json: string) => api.apply(json),
    download() {
      const url = URL.createObjectURL(new Blob([api.export()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'ui-customization.json'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
    attach(root: Document | ShadowRoot) {
      const style = document.createElement('style'); style.dataset.ui = 'customization-styles';
      (root instanceof Document ? root.head : root).append(style);
      const ref = new WeakRef(style); styles.add(ref); render();
      return () => { style.remove(); styles.delete(ref); };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => revision,
  };
  return api;
}
export const uiCustomization = createCustomization();
export function customizeShadow(root: ShadowRoot) {
  uiCustomization.attach(root); window.uiCustomization = uiCustomization;
  void uiCustomization.ready().catch(() => { /* Keep default styles if local preferences cannot be restored. */ });
}
declare global { interface Window { uiCustomization: typeof uiCustomization } }

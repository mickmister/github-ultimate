import { expect, test } from 'vitest';
import { createCustomization, customizationCSS, defaultCustomization, parseCustomization } from '../src/ui-customization';

test('customization preview, full JSON round trip and local restore preserve tokens and CSS', async () => {
  let saved: string | null = null;
  const store = { read: async () => saved, write: async (value: string) => { saved = value; } };
  const api = createCustomization(store);
  await api.ready();
  const theme = { ...defaultCustomization(), name: 'Shared theme', mode: 'dark' as const, tokens: { accent: '#12ab78', fontSize: '17px', radius: '2px' }, css: '[data-ui="review-choice"] { border-style: dashed; }' };
  await api.preview(theme);
  expect(saved).toBeNull();
  expect(api.get()).toEqual(theme);
  api.cancelPreview(); expect(api.get()).toEqual(defaultCustomization());
  await api.apply(theme);
  expect(parseCustomization(api.export())).toEqual(theme);
  const reopened = createCustomization(store); await reopened.ready();
  expect(reopened.get()).toEqual(theme);
  expect(customizationCSS(theme, ':host')).toContain(':host, :host([data-theme]){color-scheme:dark;');
  expect(customizationCSS(theme)).toContain('--accent:#12ab78;');
  await expect(api.import(JSON.stringify({ ...theme, version: 2 }))).rejects.toThrow();
  await expect(api.apply({ ...theme, tokens: { accent: 'red;display:none' } })).rejects.toThrow();
  expect(api.get()).toEqual(theme);
  await api.reset(); expect(parseCustomization(saved!)).toEqual(defaultCustomization());
});

test('failed persistence does not apply a theme, and reset recovers corrupt saved data or a late restore', async () => {
  const api = createCustomization({ read: async () => null, write: async () => { throw new Error('Storage unavailable'); } });
  await expect(api.apply({ ...defaultCustomization(), name: 'Unsaved' })).rejects.toThrow('Storage unavailable');
  expect(api.get()).toEqual(defaultCustomization());
  let saved = 'invalid JSON';
  const corrupt = createCustomization({ read: async () => saved, write: async value => { saved = value; } });
  await expect(corrupt.ready()).rejects.toThrow();
  await corrupt.reset(); await corrupt.ready();
  expect(parseCustomization(saved)).toEqual(defaultCustomization());
  let resolve!: (value: string) => void;
  const late = createCustomization({ read: () => new Promise<string>(done => { resolve = done; }), write: async () => {} });
  const pending = late.ready(); await late.reset();
  resolve(JSON.stringify({ ...defaultCustomization(), name: 'Old' })); await pending;
  expect(late.get()).toEqual(defaultCustomization());
});

import { expect, test } from '@playwright/test';

test('native shell receives resolved colors on bridge readiness, preview, cancel, restore and system changes', async ({ page }) => {
  const colors: Record<string, string>[] = [];
  await page.exposeFunction('recordShellTheme', (raw: string) => { colors.push(JSON.parse(raw).params); });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/iframe.html?id=web-app-customization--appearance-editor&viewMode=story');
  await expect.poll(() => page.evaluate(() => !!window.uiCustomization), { timeout: 30000 }).toBe(true);
  await page.evaluate(() => window.uiCustomization.ready());
  const connect = () => page.evaluate(() => {
    window.alohakNative = { protocolVersion: 1, documentId: 'test', postMessage(raw) { void (window as unknown as { recordShellTheme(raw: string): Promise<void> }).recordShellTheme(raw); } };
    window.dispatchEvent(new Event('alohak-native-ready'));
  });
  await connect();
  const initial = () => colors.at(-1);
  await expect.poll(() => initial()?.background).toBe('#f5f7fb');
  await page.evaluate(() => window.uiCustomization.preview({ ...window.uiCustomization.get(), mode: 'dark', tokens: { background: 'navy', accent: 'rgb(12, 34, 56)' }, css: ':root { --panel: rebeccapurple; }' }));
  await expect.poll(initial).toMatchObject({ background: '#000080', accent: '#0c2238', surface: '#663399' });
  await page.evaluate(() => window.uiCustomization.cancelPreview());
  await expect.poll(() => initial()?.background).toBe('#f5f7fb');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => initial()?.background).toBe('#101724');
  await page.evaluate(() => window.uiCustomization.apply({ ...window.uiCustomization.get(), mode: 'light', tokens: { background: '#abc123' } }));
  await expect.poll(() => initial()?.background).toBe('#abc123');
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.uiCustomization?.get().tokens.background)).toBe('#abc123');
  await connect();
  await expect.poll(() => initial()?.background).toBe('#abc123');
  await page.evaluate(() => window.uiCustomization.reset());
  await expect.poll(() => initial()?.background).toBe('#101724');
});

test('UI and console share portable JSON, preview/reset, shadow styling and device persistence', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-customization--appearance-editor&viewMode=story');
  await page.getByText('Customize appearance', { exact: true }).click();
  const save = page.getByRole('button', { name: 'Save customization locally', exact: true });
  await expect(save).toBeEnabled({ timeout: 30000 });
  await page.getByText('Advanced JSON and console', { exact: true }).click();
  const theme = await page.evaluate(() => ({ ...window.uiCustomization.get(), name: 'Portable', mode: 'dark' as const, tokens: { accent: '#12ab78', fontSize: '17px', radius: '3px' }, css: '[data-ui="review-choice"] { border-style: dashed; }' }));
  await page.getByLabel('Customization JSON', { exact: true }).fill(JSON.stringify(theme));
  await page.getByRole('button', { name: 'Preview customization', exact: true }).click();
  await expect(page.getByText('Preview active; not saved.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#12ab78');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.locator('[data-ui="review-choice"]').first()).toHaveCSS('border-top-style', 'dashed');
  await expect(page.getByTestId('legacy-theme-host').locator('[data-ui="review-choice"]').first()).toHaveCSS('border-top-style', 'dashed');
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  expect(await page.evaluate(() => window.uiCustomization.get().name)).toBe('Default');
  await page.getByLabel('Customization JSON', { exact: true }).fill(JSON.stringify(theme)); await save.click();
  await expect(page.getByText('Customization saved on this device.', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export customization JSON', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('ui-customization.json');
  expect(await page.evaluate(() => JSON.parse(window.uiCustomization.export()))).toEqual(theme);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.uiCustomization?.get().name)).toBe('Portable');
  await page.evaluate(() => window.uiCustomization.reset());
  await page.getByText('Customize appearance', { exact: true }).click();
  await page.getByText('Advanced JSON and console', { exact: true }).click();
  await page.getByLabel('Import customization JSON', { exact: true }).setInputFiles({ name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theme)) });
  await expect.poll(() => page.evaluate(() => window.uiCustomization.get().name)).toBe('Portable');
  await page.getByLabel('Customization JSON', { exact: true }).fill('{"version":99}'); await save.click();
  await expect(page.locator('[data-ui="customization-panel"]').getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.uiCustomization.get().name)).toBe('Portable');
  await page.evaluate(() => window.uiCustomization.reset());
});

test('built-in themes and individual settings share a draft and remain portable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=web-app-customization--appearance-editor&viewMode=story');
  await page.getByText('Customize appearance', { exact: true }).click();
  const presets = page.getByLabel('Built-in theme', { exact: true });
  await expect(presets).toBeEnabled({ timeout: 30000 });
  for (const [id, mode] of [['daylight', 'light'], ['midnight', 'dark'], ['paper', 'light'], ['forest', 'dark']]) {
    await presets.selectOption(id);
    await expect(page.getByLabel('Appearance mode', { exact: true })).toHaveValue(mode);
  }
  // Loading a preset edits the draft; the active/saved theme changes only on preview/save.
  expect(await page.evaluate(() => window.uiCustomization.get().name)).toBe('Default');
  await expect(page.getByLabel('Accent color', { exact: true })).toHaveValue('#88d9ae');
  await page.getByLabel('Theme name', { exact: true }).fill('My forest');
  await page.getByLabel('Accent color', { exact: true }).fill('#45ab78');
  await page.getByLabel('Pick background color', { exact: true }).fill('#14251f');
  await page.getByLabel('Font family', { exact: true }).fill('monospace');
  await page.getByLabel('Font size', { exact: true }).fill('18px');
  await page.getByLabel('Corner radius', { exact: true }).fill('0px');
  await page.getByLabel('Spacing', { exact: true }).fill('10px');
  await page.getByLabel('Content width', { exact: true }).fill('1100px');
  await page.getByLabel('Custom CSS', { exact: true }).fill('[data-ui="review-choice"] { border-style: dotted; }');
  await page.getByRole('button', { name: 'Preview customization', exact: true }).click();
  expect(await page.evaluate(() => window.uiCustomization.get())).toMatchObject({ name: 'My forest', mode: 'dark', tokens: { accent: '#45ab78', background: '#14251f', fontSize: '18px', fontFamily: 'monospace', radius: '0px', spacing: '10px', contentWidth: '1100px' } });
  await page.getByRole('button', { name: 'Use default spacing', exact: true }).click();
  await expect(page.getByLabel('Spacing', { exact: true })).toHaveValue('');
  await page.getByText('Advanced JSON and console', { exact: true }).click();
  const draft = JSON.parse(await page.getByLabel('Customization JSON', { exact: true }).inputValue());
  expect(draft.tokens.spacing).toBeUndefined();
  expect(draft.css).toContain('border-style: dotted');
  draft.tokens.lineHeight = '1.8';
  await page.getByLabel('Customization JSON', { exact: true }).fill(JSON.stringify(draft));
  await expect(page.getByLabel('Line height', { exact: true })).toHaveValue('1.8');
  await page.getByRole('button', { name: 'Save customization locally', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.uiCustomization.export()))).toEqual(draft);
  expect(await page.locator('[data-ui="customization-panel"]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.uiCustomization?.get().name)).toBe('My forest');
  await page.evaluate(() => window.uiCustomization.reset());
});

import { test, expect } from '@playwright/test';

const configurations = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 900, 1440], ['desktop', 'landscape', 1440, 900],
] as const;

if (process.env.APPEARANCE_BROWSER === 'webkit') test.use({ browserName: 'webkit' });
test.describe('appearance', () => {
  for (const [surface, orientation, width, height] of configurations) {
    test(`${surface} ${orientation}: draft, preview, stop and save`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/iframe.html?id=web-app-customization--${surface}-${orientation}&viewMode=story`);
      const screen = page.locator('main[data-surface]');
      await expect(screen).toHaveAttribute('data-surface', surface, { timeout: 30000 });
      await expect(screen).toHaveAttribute('data-orientation', orientation);
      await expect(screen).toHaveCount(1);
      await page.getByLabel('Theme name', { exact: true }).fill('Authored theme');
      await page.locator('summary').filter({ hasText: /^Colors$/ }).click();
      await page.getByLabel('Accent color', { exact: true }).fill('#126abc');
      await expect(page.getByText('Unsaved draft', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
      await expect(page.getByRole('complementary', { name: 'Active appearance' }).getByText('Preview active · not saved', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.uiCustomization.getSaved().name)).toBe('Default');
      await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
      await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Authored theme');
      expect(await page.evaluate(() => window.uiCustomization.get().name)).toBe('Default');
      await page.getByRole('button', { name: 'Save on this device', exact: true }).click();
      await expect(page.getByText('Draft matches saved theme', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.uiCustomization.getSaved().tokens.accent)).toBe('#126abc');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const box = await page.getByRole('button', { name: 'Preview draft', exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath('appearance.png'), fullPage: true });
    });
  }
  test('import/export, invalid JSON, persistence failure, external saves and provider lifetime', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/iframe.html?id=web-app-customization--appearance-editor&viewMode=story');
    await page.getByLabel('Theme name', { exact: true }).fill('Unfinished authored theme');
    await page.locator('summary').filter({ hasText: /^Colors$/ }).click();
    await page.getByLabel('Accent color', { exact: true }).fill('#12');
    await expect(page.getByLabel('Accent color', { exact: true })).toBeEditable();
    await expect(page.getByRole('button', { name: 'Preview draft', exact: true })).toBeDisabled();
    await page.getByLabel('Accent color', { exact: true }).fill('#126abc');
    await page.getByText('Advanced CSS / JSON', { exact: true }).last().click();
    const authoredCSS = '/* Preserve authored whitespace */\n[data-ui="review-choice"] { border-style: dashed; }\n';
    await page.getByLabel('Custom CSS', { exact: true }).fill(authoredCSS);
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await page.getByLabel('Theme name', { exact: true }).fill('Newer draft');
    await expect(page.getByText('Preview active · draft has newer edits', { exact: true })).toBeVisible();
    for (const [surface, orientation, width, height] of configurations) {
      await page.getByLabel('Theme name', { exact: true }).blur();
      await page.setViewportSize({ width, height });
      await expect(page.locator('main[data-surface]')).toHaveAttribute('data-surface', surface);
      await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Newer draft');
      await expect(page.getByLabel('Custom CSS', { exact: true })).toHaveValue(authoredCSS);
    }
    await page.getByRole('button', { name: 'Leave appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Return to appearance', exact: true }).click();
    await expect(page.getByLabel('Custom CSS', { exact: true })).toHaveValue(authoredCSS);
    await page.evaluate(async () => { await window.uiCustomization.apply({ ...window.uiCustomization.getSaved(), name: 'External theme' }); });
    await expect(page.getByRole('alert')).toContainText('Your draft is preserved');
    await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Newer draft');
    await expect(page.getByRole('button', { name: 'Save on this device', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Keep my draft', exact: true }).click();
    await page.getByRole('button', { name: 'Fail next save', exact: true }).click();
    await page.getByRole('button', { name: 'Save on this device', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Device storage unavailable');
    expect(await page.evaluate(() => window.uiCustomization.getSaved().name)).toBe('External theme');
    await expect(page.getByLabel('Custom CSS', { exact: true })).toHaveValue(authoredCSS);
    await page.getByRole('button', { name: 'Save on this device', exact: true }).click();
    await expect(page.getByText('Draft matches saved theme', { exact: true })).toBeVisible();
    const json = page.getByLabel('Customization JSON', { exact: true });
    const good = await json.inputValue();
    await json.fill('{ invalid authored JSON');
    await expect(page.getByRole('button', { name: 'Save on this device', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export draft JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('appearance-draft.json');
    const stream = await download.createReadStream();
    let exported = ''; for await (const chunk of stream!) exported += chunk.toString();
    expect(exported).toBe('{ invalid authored JSON');
    await page.getByLabel('Import JSON into draft', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('bad') });
    await expect(json).toHaveValue('{ invalid authored JSON');
    const imported = { ...JSON.parse(good), name: 'Imported theme', css: authoredCSS };
    await page.getByLabel('Import JSON into draft', { exact: true }).setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Imported theme');
    expect(await page.evaluate(() => window.uiCustomization.getSaved().name)).toBe('Newer draft');
    await page.getByRole('button', { name: 'Reset draft to defaults', exact: true }).click();
    await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Default');
    await page.getByRole('button', { name: 'Undo draft replacement', exact: true }).click();
    await expect(page.getByLabel('Custom CSS', { exact: true })).toHaveValue(authoredCSS);
    await page.evaluate(async () => { await window.uiCustomization.apply({ ...window.uiCustomization.getSaved(), name: 'Another external save' }); });
    await page.getByRole('button', { name: 'Load saved theme', exact: true }).first().click();
    await expect(page.getByLabel('Theme name', { exact: true })).toHaveValue('Another external save');
  });
});

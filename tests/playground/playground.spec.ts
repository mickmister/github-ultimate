import { test, expect } from '@playwright/test';

test('real renderer stories, local comment flow, CSS edits and theme controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Investigate the failing checks', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Only failing unit tests' }).check();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep these answers while styling.');
  await page.getByRole('textbox', { name: 'CSS overrides' }).fill('.form-card { border-radius: 32px; }');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep these answers while styling.');
  expect(await page.locator('#renderer').evaluate(host => getComputedStyle(host.shadowRoot!.querySelector('.form-card')!).borderRadius)).toBe('32px');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('#renderer')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Accent', { exact: true }).fill('#00aa88');
  expect(await page.locator('#renderer').evaluate(host => getComputedStyle(host).getPropertyValue('--accent').trim())).toBe('#00aa88');
  await page.getByLabel('Canvas width', { exact: true }).selectOption('390');
  await expect.poll(async () => (await page.locator('#renderer').boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  await page.getByRole('button', { name: 'Place in GitHub comment editor' }).click();
  await expect(page.getByRole('textbox', { name: 'Local GitHub comment editor' })).toHaveValue(/\/github-ultimate approve/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/playground-dark.png', fullPage: true });
});

test('source edits validate, YAML forms render, and snapshots/saved responses are available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Follow-up question/ }).click();
  await expect(page.getByRole('heading', { name: 'A quick follow-up question' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approved for next steps', exact: true })).toHaveCount(0);
  const source = page.getByRole('textbox', { name: 'Frontmatter source' });
  await source.fill('format: standard\nid: editable\ntitle: My custom form\nquestions:\n  - id: note\n    type: textarea\n    title: My custom question');
  await page.getByRole('button', { name: 'Render source', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My custom form' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My custom form' })).toBeVisible();
  await page.getByRole('button', { name: /Workflow & beads/ }).click();
  await expect(page.getByText('1 / 3 beads complete')).toBeVisible();
  await page.getByRole('button', { name: /Saved response/ }).click();
  await expect(page.getByRole('heading', { name: 'Approved for next steps' })).toBeVisible();
  await page.getByRole('button', { name: /Superseded form/ }).click();
  await expect(page.getByText(/This form was superseded/)).toBeVisible();
  await page.getByRole('button', { name: /Validation error/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Invalid record', { exact: true })).toBeVisible();
});

test('source and style overrides export for a fork or upstream contribution', async ({ page }) => {
  await page.goto('/');
  const sourceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export source', exact: true }).click();
  expect((await sourceDownload).suggestedFilename()).toBe('github-ultimate-record.txt');
  const cssDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSS', exact: true }).click();
  expect((await cssDownload).suggestedFilename()).toBe('github-ultimate-custom.css');
});

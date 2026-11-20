import { expect, test } from '@playwright/test';

const first = 'a6075abf-226e-4c88-977c-e11404e59f32';
const second = 'b6075abf-226e-4c88-977c-e11404e59f32';
const url = '/iframe.html?id=web-app-reviews--storage-picker&viewMode=story';

for (const width of [1280, 390]) {
  test(`selects connection, storage repo and workspace without typing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/__review-picker-fixture', route => {
      const operation = route.request().headers()['x-picker-operation'];
      return route.fulfill({ json: operation === 'repositories'
        ? [{ fullName: 'example/storage', private: true }, { fullName: 'example/other', private: false }]
        : [{ id: 'reader-workspace', hasDocuments: true }, { id: 'other-workspace', hasDocuments: true }, { id: 'dolt-only', hasDocuments: false }] });
    });
    await page.goto(url);
    await expect(page.getByLabel('Storage repository', { exact: true })).toBeDisabled({ timeout: 30000 });
    await page.getByLabel('Approved connection', { exact: true }).selectOption(first);
    await expect(page.getByLabel('Storage repository', { exact: true })).toBeEnabled();
    await page.getByLabel('Storage repository', { exact: true }).selectOption('example/storage');
    await expect(page.getByLabel('Workspace', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Workspace', { exact: true }).locator('option')).toHaveText(['Choose a workspace', 'other-workspace', 'reader-workspace']);
    await page.getByLabel('Workspace', { exact: true }).selectOption('reader-workspace');
    await page.getByRole('button', { name: 'Open review inbox', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Reader follow-up', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('late workspace discovery cannot replace a newer repository selection', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__review-picker-fixture', async route => {
    const headers = route.request().headers();
    if (headers['x-picker-operation'] === 'repositories') return route.fulfill({ json: [{ fullName: 'example/storage', private: true }, { fullName: 'example/new', private: true }] });
    if (headers['x-picker-repository'] === 'example/storage') { await gate; return route.fulfill({ json: [{ id: 'stale-workspace', hasDocuments: true }] }); }
    return route.fulfill({ json: [{ id: 'new-workspace', hasDocuments: true }] });
  });
  await page.goto(url);
  await page.getByLabel('Approved connection', { exact: true }).selectOption(first);
  await page.getByLabel('Storage repository', { exact: true }).selectOption('example/storage');
  await expect(page.getByRole('status')).toHaveText('Finding workspaces…');
  await page.getByLabel('Storage repository', { exact: true }).selectOption('example/new');
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('new-workspace');
  release();
  await expect(page.getByLabel('Workspace', { exact: true }).locator('option')).toHaveText(['Choose a workspace', 'new-workspace']);
});

test('connection changes reset storage choices and ignore stale repository results', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__review-picker-fixture', async route => {
    const headers = route.request().headers();
    if (headers['x-picker-operation'] === 'workspaces') return route.fulfill({ json: [{ id: 'second-workspace', hasDocuments: true }] });
    if (headers['x-picker-connection'] === first) { await gate; return route.fulfill({ json: [{ fullName: 'stale/storage', private: true }] }); }
    return route.fulfill({ json: [{ fullName: 'second/storage', private: true }] });
  });
  await page.goto(url);
  await page.getByLabel('Approved connection', { exact: true }).selectOption(first);
  await expect(page.getByRole('status')).toHaveText('Loading repositories…');
  await page.getByLabel('Approved connection', { exact: true }).selectOption(second);
  await expect(page.getByLabel('Storage repository', { exact: true })).toHaveValue('second/storage');
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('second-workspace');
  release();
  await expect(page.getByLabel('Storage repository', { exact: true }).locator('option')).toHaveText(['Choose a storage repository', 'second/storage · private']);
});

test('failed discovery can be retried using Reload choices', async ({ page }) => {
  let fail = true;
  await page.route('**/__review-picker-fixture', route => {
    if (fail) return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.fulfill({ json: route.request().headers()['x-picker-operation'] === 'repositories' ? [{ fullName: 'example/storage', private: true }] : [{ id: 'reader-workspace', hasDocuments: true }] });
  });
  await page.goto(url);
  await page.getByLabel('Approved connection', { exact: true }).selectOption(first);
  await expect(page.getByRole('alert')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Reload choices', exact: true }).click();
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('reader-workspace');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('complete pinned review links skip repository and workspace discovery', async ({ page }) => {
  let discovery = 0;
  await page.route('**/__review-picker-fixture', route => { discovery++; return route.abort(); });
  const query = new URLSearchParams({ connection: first, repository: 'example/storage', workspace: 'reader-workspace', version: 'e'.repeat(40), snapshot: '1'.repeat(40) });
  await page.goto(`${url}#/reviews/reader-01?${query}`);
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible({ timeout: 30000 });
  expect(discovery).toBe(0);
});

for (const process of [false, true]) {
  test(`explains ${process ? 'process workflow dispatch' : 'feedback-only submission'} before review and form submission`, async ({ page }) => {
    await page.goto(`/iframe.html?id=web-app-reviews--${process ? 'process-context' : 'focused'}&viewMode=story`);
    const notice = process ? 'Saves feedback and requests a workflow run for hosted-pilot.' : 'Saves feedback; no GitHub workflow run.';
    await expect(page.locator('.review-submit')).toContainText(notice);
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    while (await page.getByRole('button', { name: 'Next question', exact: true }).count()) await page.getByRole('button', { name: 'Next question', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
    await expect(page.locator('.review-form')).toContainText(notice);
  });
}

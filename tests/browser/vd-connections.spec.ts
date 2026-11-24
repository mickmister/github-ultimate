import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('packaged VD settings test unsaved headers, save securely, preserve edits and survive browser restart', async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(resolve(tmpdir(), 'ghu-vd-')); let context: BrowserContext | undefined;
  try {
    const extension = resolve(directory, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://vd.example.test/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    const launch = async () => {
      context = await chromium.launchPersistentContext(resolve(directory, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      await worker.evaluate(() => {
        globalThis.fetch = async (url, init) => {
          if (String(url) !== 'https://vd.example.test/api/workspaces' || init?.method !== 'GET' || new Headers(init.headers).get('authorization') !== 'Bearer vd-private-test-token') return Response.json({ success: false }, { status: 401 });
          return Response.json({ success: true, data: [{ id: '46e5772c-a538-498f-b3ae-4d7073dddc39' }] });
        };
      });
      const id = worker.url().split('/')[2], page = await context.newPage(); await page.goto(`chrome-extension://${id}/connections.html`); return page;
    };
    let page = await launch();
    await page.getByLabel('VD connection name').fill('Home VD');
    await page.getByLabel('VD origin', { exact: true }).fill('https://vd.example.test');
    await expect(page.locator('#vd-add input[name="repository"], #vd-add input[name="workspace"], #vd-add input[name="workspaceId"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add VD header', exact: true }).click();
    await page.getByLabel('Header name', { exact: true }).fill('Authorization');
    await page.getByLabel('Replacement value', { exact: false }).fill('Bearer vd-private-test-token');
    await page.getByRole('button', { name: 'Test VD connection', exact: true }).click();
    await expect(page.locator('#vd-status')).toContainText('succeeded');
    await expect(page.getByRole('article', { name: 'Home VD' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save VD connection', exact: true }).click();
    const card = page.getByRole('article', { name: 'Home VD' }); await expect(card).toContainText('Secret configured');
    await expect(card).toContainText('All accessible workspaces');
    await expect(page.getByLabel('Replacement value', { exact: false })).toHaveCount(0);
    expect(await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).not.toContain('vd-private');
    await card.getByRole('button', { name: 'Edit VD connection' }).click();
    await expect(page.getByLabel('Replacement value', { exact: false })).toHaveValue('');
    await page.getByRole('button', { name: 'Test VD connection', exact: true }).click(); await expect(page.locator('#vd-status')).toContainText('succeeded');
    await context!.close(); page = await launch();
    await expect(page.getByRole('article', { name: 'Home VD' })).toContainText('Secret configured');
    await page.getByRole('article', { name: 'Home VD' }).getByRole('button', { name: 'Edit VD connection' }).click();
    await page.getByRole('button', { name: 'Test VD connection', exact: true }).click(); await expect(page.locator('#vd-status')).toContainText('succeeded');
  } finally { await context?.close(); await rm(directory, { recursive: true, force: true }); }
});

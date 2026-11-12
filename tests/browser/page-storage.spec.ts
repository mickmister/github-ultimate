import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

test('packaged origin storage survives restart, denies spoofed paths and revocation, and stays separate from connection access', async ({}, info) => {
  test.setTimeout(90000);
  const profile = info.outputPath('profile'), extension = info.outputPath('extension');
  await mkdir(profile, { recursive: true }); await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://apps.example.test/*', 'https://other.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  let context: BrowserContext;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await context.route(/https:\/\/(apps|other)\.example\.test\//, async route => {
      const url = new URL(route.request().url()), name = url.pathname.split('/').pop()!;
      if (name !== 'mobile-proof.html' && !/^[\w-]+\.(js|css)$/.test(name)) return route.fulfill({ status: 404 });
      if (name === 'mobile-proof.html' && url.pathname.startsWith('/spoof/')) {
        const html = await readFile(resolve('hosted-dist', name), 'utf8');
        return route.fulfill({ contentType: 'text/html', body: html.replace('<head>', '<head><script>history.replaceState({}, "", "/approved/mobile-proof.html")</script>') });
      }
      return route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    return worker.url().split('/')[2];
  }
  async function approve(settings: Page, origin: string) {
    await settings.getByLabel('Page storage origin', { exact: true }).fill(origin);
    await settings.getByLabel('Page storage subpath', { exact: true }).fill('/approved/');
    await settings.getByRole('button', { name: 'Grant page storage', exact: true }).click();
    await expect(settings.locator('#page-storage-grants')).toContainText(origin);
  }
  async function open(page: Page, path = 'https://apps.example.test/approved/mobile-proof.html') {
    await page.goto(path);
    await page.getByLabel('Storage backend', { exact: true }).selectOption('extension');
    await page.getByLabel('Override localStorage after hydration (method API)').check();
    await page.getByRole('button', { name: 'Open page storage', exact: true }).click();
  }
  try {
    let id = await launch();
    let settings = await context!.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
    await approve(settings, 'https://apps.example.test'); await approve(settings, 'https://other.example.test');
    let page = await context!.newPage(); await open(page);
    await expect(page.locator('#storage-result')).toHaveText('[]');
    await page.getByRole('button', { name: 'Save page value', exact: true }).click();
    await expect(page.locator('#storage-result')).toContainText('["example.dotted.key",""]');
    expect(await page.evaluate(() => localStorage.getItem('example.dotted.key'))).toBe('');
    expect(await page.evaluate(() => localStorage.length)).toBe(1);
    const other = await context!.newPage(); await open(other, 'https://other.example.test/approved/mobile-proof.html');
    await expect(other.locator('#storage-result')).toHaveText('[]');
    const denied = await context!.newPage(); await open(denied, 'https://apps.example.test/spoof/mobile-proof.html');
    await expect(denied.locator('#storage-result')).toContainText('not approved');
    expect(new URL(denied.url()).pathname).toBe('/approved/mobile-proof.html');
    await context!.close(); id = await launch();
    page = await context!.newPage(); await open(page);
    await expect(page.locator('#storage-result')).toContainText('["example.dotted.key",""]');
    settings = await context!.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
    await settings.getByRole('button', { name: 'Revoke page storage https://apps.example.test/approved/', exact: true }).click();
    await expect(settings.locator('#page-storage-grants')).not.toContainText('https://apps.example.test');
    await page.getByRole('button', { name: 'Refresh stored values' }).click();
    await expect(page.locator('#storage-result')).toContainText('not approved');
    expect(await settings.locator('#connections').textContent()).toContain('No connections');
  } finally { await context!?.close(); }
});

test('plain browser backend supports the same hydrated method API without an extension', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('https://page.example/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  const page = await context.newPage();
  await page.goto('https://page.example/mobile-proof.html');
  await page.getByLabel('Override localStorage after hydration (method API)').check();
  await page.getByRole('button', { name: 'Open page storage', exact: true }).click();
  await expect(page.locator('#storage-result')).toHaveText('[]');
  await page.getByLabel('Storage value', { exact: true }).fill('browser value');
  await page.getByRole('button', { name: 'Save page value', exact: true }).click();
  await expect(page.locator('#storage-result')).toContainText('browser value');
  await page.reload();
  await page.getByRole('button', { name: 'Open page storage', exact: true }).click();
  await expect(page.locator('#storage-result')).toContainText('browser value');
  await context.close();
});

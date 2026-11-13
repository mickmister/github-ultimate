import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let context: BrowserContext, profile: string;
async function mockStorage(worker: Worker) {
  await worker.evaluate(() => {
    const state = globalThis as typeof globalThis & { __s3Calls: { url: string; method: string; conditional: string | null }[]; __s3Objects: Map<string, string> };
    state.__s3Calls = []; state.__s3Objects = new Map([['workspace-a/note.txt', 'Private <script>window.__unsafeS3 = true</script> object']]);
    globalThis.fetch = async (input, init) => {
      const request = input as Request, url = new URL(request.url);
      if (url.origin !== 'https://storage.example.test') throw new Error('Unexpected endpoint');
      state.__s3Calls.push({ url: request.url, method: request.method, conditional: request.headers.get('If-None-Match') });
      if (!request.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=EXAMPLEACCESS/') || init?.redirect !== 'error' || init?.credentials !== 'omit') return new Response('', { status: 403 });
      if (url.searchParams.get('list-type') === '2') {
        const contents = [...state.__s3Objects].map(([key, text]) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${new TextEncoder().encode(text).length}</Size></Contents>`).join('');
        return new Response(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
      }
      const key = decodeURIComponent(url.pathname.slice('/staging-bucket/'.length));
      if (request.method === 'PUT') {
        if (state.__s3Objects.has(key) && request.headers.get('If-None-Match') === '*') return new Response('', { status: 412 });
        state.__s3Objects.set(key, await request.text());
        return new Response(null, { headers: { ETag: 'fixture-etag', 'x-amz-version-id': 'fixture-version' } });
      }
      return state.__s3Objects.has(key) ? new Response(state.__s3Objects.get(key), { headers: { 'Content-Type': 'text/plain' } }) : new Response('', { status: 404 });
    };
  });
}
async function launch(legacy = false) {
  const extension = resolve(profile, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  if (legacy) { manifest.version = '0.0.1'; manifest.background.service_worker = 'legacy-background.js'; }
  manifest.host_permissions.push('https://apps.example.test/*', 'https://storage.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  if (legacy) await writeFile(resolve(extension, 'legacy-background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith(legacy ? '/legacy-background.js' : '/background.js')) ?? await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith(legacy ? '/legacy-background.js' : '/background.js') });
  await mockStorage(worker);
  await context.route('https://apps.example.test/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name !== 's3.html' && !/^[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) return route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  return worker.url().split('/')[2];
}
test.beforeEach(async () => { profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-s3-')); });
test.afterEach(async () => { await context?.close(); await rm(profile, { recursive: true, force: true }); });

test('upgrading the credential database retains existing GitHub connections and maps their origins to root grants', async () => {
  const id = await launch(true);
  await context.serviceWorkers()[0].evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('github-ultimate-credentials', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('connections', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('connections', 'readwrite');
      tx.objectStore('connections').put({ id: crypto.randomUUID(), name: 'Existing GitHub connection', appId: 12345, clientId: 'Iv23ExampleClient', user: { login: 'seeded-user', id: 1 }, installation: { id: 123, account: 'seeded-user' }, tokens: { accessToken: 'private-old-token', expiresAt: Date.now() + 3600000 }, origins: ['https://apps.example.test'] });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await context.close();
  expect(await launch()).toBe(id);
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  const card = settings.getByRole('article', { name: 'Existing GitHub connection', exact: true });
  await expect(card).toContainText('Signed in as seeded-user');
  await expect(card).toContainText('https://apps.example.test/ (all paths)');
  await expect(settings.locator('#s3-connections')).toContainText('No S3 connections yet');
  await expect(settings.locator('body')).not.toContainText('private-old-token');
});

test('packaged S3 connection signs private reads and uploads, remembers selection, survives restart and enforces revocation', async () => {
  test.setTimeout(60000);
  let id = await launch();
  let settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  await settings.getByLabel('S3 connection name').fill('Review staging');
  await settings.getByLabel('S3 endpoint', { exact: true }).fill('https://storage.example.test');
  await settings.getByLabel('S3 bucket', { exact: true }).fill('staging-bucket');
  await settings.getByLabel('S3 signing region').fill('auto');
  await settings.getByLabel('S3 allowed key prefix').fill('workspace-a');
  await settings.getByLabel('S3 access key ID').fill('EXAMPLEACCESS');
  await settings.getByLabel('S3 secret access key').fill('private-S3-secret');
  await settings.getByRole('button', { name: 'Save S3 connection', exact: true }).click();
  await expect(settings.locator('#s3-status')).toContainText('S3 connection saved');
  await expect(settings.getByLabel('S3 secret access key')).toHaveValue('');
  const card = settings.getByRole('article', { name: 'Review staging', exact: true });
  await card.getByLabel('S3 hosted origin').fill('https://apps.example.test');
  await card.getByLabel('S3 hosted subpath').fill('/storage/');
  await card.getByRole('button', { name: 'Grant hosted S3 access' }).click();
  await expect(settings.locator('#s3-status')).toContainText('grant saved');
  let page = await context.newPage(); await page.goto('https://apps.example.test/storage/s3.html');
  await expect(page.getByRole('status')).toContainText('1 object(s) loaded');
  await page.getByRole('button', { name: 'workspace-a/note.txt', exact: false }).click();
  await page.getByRole('button', { name: 'Read object', exact: true }).click();
  await expect(page.getByLabel('Object result')).toContainText('Private <script>window.__unsafeS3 = true</script> object');
  expect(await page.evaluate(() => '__unsafeS3' in window)).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toMatch(/private-S3-secret|EXAMPLEACCESS|Private <script>/);
  await page.getByLabel('File to upload (up to 8 MiB)').setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('Uploaded by browser') });
  await page.getByRole('button', { name: 'Upload object', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Object uploaded');
  await expect(page.getByLabel('Object result')).toContainText('fixture-version');
  const worker = context.serviceWorkers()[0];
  expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __s3Objects: Map<string, string> }).__s3Objects.get('workspace-a/new.txt'))).toBe('Uploaded by browser');
  await page.getByLabel('File to upload (up to 8 MiB)').setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement') });
  await page.getByRole('button', { name: 'Upload object', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('already exists');
  await page.reload(); await expect(page.getByRole('status')).toContainText('2 object(s) loaded');
  await expect(page.getByLabel('Object key', { exact: true })).toHaveValue('workspace-a/new.txt');
  const denied = await context.newPage(); await denied.goto('https://apps.example.test/other/s3.html');
  await expect(denied.getByRole('status')).toContainText('No S3 connections are approved');
  expect(await settings.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).not.toMatch(/private-S3-secret|EXAMPLEACCESS/);
  await context.close();
  id = await launch();
  settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  await expect(settings.getByRole('article', { name: 'Review staging', exact: true })).toBeVisible();
  page = await context.newPage(); await page.goto('https://apps.example.test/storage/s3.html');
  await expect(page.getByRole('status')).toContainText('1 object(s) loaded');
  await page.getByLabel('Object key', { exact: true }).fill('workspace-a/note.txt');
  const before = await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __s3Calls: unknown[] }).__s3Calls.length);
  await settings.getByRole('button', { name: 'Revoke S3 grant https://apps.example.test/storage/', exact: true }).click();
  await page.getByRole('button', { name: 'Read object', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not approved');
  expect(await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __s3Calls: unknown[] }).__s3Calls.length)).toBe(before);
});

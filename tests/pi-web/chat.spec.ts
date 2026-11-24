import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { nativeFixture, remoteFixture } from './native-fixture';
const root = resolve('hosted-dist/pi-web');
let server: Server, origin: string, base: string;
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
test.beforeAll(async () => {
  if (process.env.PI_WEB_PUBLIC_URL) {
    const url = new URL(process.env.PI_WEB_PUBLIC_URL);
    origin = url.origin; base = url.pathname;
    const response = await fetch(`${origin}${base}build.json`);
    expect(response.ok).toBe(true);
    const metadata = await response.json();
    expect(metadata.demo).toBe(false);
    if (process.env.PI_WEB_PUBLIC_SHA) expect(metadata.sha).toBe(process.env.PI_WEB_PUBLIC_SHA);
    return;
  }
  base = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8')).basePath;
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname), filePath = resolve(root, pathname.slice(base.length));
    if (!pathname.startsWith(base) || filePath !== root && !filePath.startsWith(root + sep)) { response.writeHead(404).end(); return; }
    try { const file = (await stat(filePath)).isDirectory() ? resolve(filePath, 'index.html') : filePath; response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); response.end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

for (const [name, width, height] of [['phone portrait',390,844],['phone landscape',844,390],['tablet portrait',820,1180],['tablet landscape',1180,820],['desktop portrait',1080,1440],['desktop landscape',1440,900]] as const) {
  test(`${name}: real S3 chat survives rotation and reload through the native wire protocol`, async ({ page }) => {
    const remote = remoteFixture(), fixture = await nativeFixture(page, `${origin}${base}`, remote), errors: string[] = [], api: string[] = [];
    page.on('pageerror', error => { if (error.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(error.message); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
    await page.setViewportSize({ width, height }); await page.goto(`${origin}${base}`);
    const create = page.getByRole('button', { name: 'New conversation', exact: true }); await expect(create).toBeEnabled(); await create.click();
    await expect(page.getByRole('status')).toContainText('Draft');
    expect(remote.objects.size).toBe(0); expect(new URL(page.url()).searchParams.has('session')).toBe(false);
    const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('Hello from a real session'); await input.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect.poll(() => JSON.parse([...remote.objects.values()].at(-1)!.text).messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Real Pi reply 1: Café 🌴' }] });
    await expect(page.getByRole('alert').filter({ hasText: /.+/ })).toHaveCount(0);
    await expect(page.getByRole('log')).toContainText('Real Pi reply 1: Café 🌴');
    await input.fill('Retain this unsent draft'); await page.setViewportSize({ width: height, height: width }); await expect(input).toHaveValue('Retain this unsent draft');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload(); await expect(page.getByRole('log')).toContainText('Real Pi reply 1: Café 🌴');
    await expect(page.getByRole('status')).toHaveText('Saved to S3'); expect(remote.requests).toHaveLength(1);
    expect(await page.content()).not.toContain('private-fixture-secret'); expect(errors).toEqual([]); expect(api).toEqual([]); fixture.dispose();
  });
}
test('independent device connections restore the same S3 conversation and preserve divergent continuations', async ({ browser }) => {
  const remote = remoteFixture(), first = await browser.newContext(), second = await browser.newContext();
  try {
    const left = await first.newPage(), right = await second.newPage();
    const a = await nativeFixture(left, `${origin}${base}`, remote), b = await nativeFixture(right, `${origin}${base}`, remote);
    expect(a.storage.id).not.toBe(b.storage.id); expect(a.inference.id).not.toBe(b.inference.id);
    await left.goto(`${origin}${base}`); await expect(left.getByRole('button', { name: 'New conversation' })).toBeEnabled(); await left.getByRole('button', { name: 'New conversation' }).click();
    await expect(left.getByRole('status')).toContainText('Draft'); await left.getByRole('textbox', { name: 'Message', exact: true }).fill('Start on desktop'); await left.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(left.getByRole('status')).toHaveText('Saved to S3'); await expect(left.getByRole('log')).toContainText('Real Pi reply 1');
    const link = left.url(), parent = new URL(link).searchParams.get('checkpoint');
    await right.goto(link); await expect(right.getByRole('log')).toContainText('Real Pi reply 1'); expect(remote.requests).toHaveLength(1);
    await right.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue on phone'); await right.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(right.getByRole('log')).toContainText('Real Pi reply 2'); await expect(right.getByRole('status')).toHaveText('Saved to S3');
    expect(remote.requests[1].messages).toContainEqual({ role: 'assistant', content: 'Real Pi reply 1: Café 🌴' });
    await left.getByRole('textbox', { name: 'Message', exact: true }).fill('Independent desktop continuation'); await left.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(left.getByRole('log')).toContainText('Real Pi reply 3'); await expect(left.getByRole('status')).toHaveText('Saved to S3');
    const children = [...remote.objects.values()].map(object => JSON.parse(object.text)).filter(checkpoint => checkpoint.parent === parent);
    expect(children).toHaveLength(2); expect(new Set(children.map(child => child.branch_id)).size).toBe(2);
    await left.goto(right.url()); await expect(left.getByRole('log')).toContainText('Continue on phone'); await expect(left.getByRole('log')).toContainText('Real Pi reply 2');
    a.dispose(); b.dispose();
  } finally { await first.close(); await second.close(); }
});
test('new is only a draft and the upstream-adapted sidebar shows one row per conversation', async ({ page }) => {
  const remote = remoteFixture(), fixture = await nativeFixture(page, `${origin}${base}`, remote);
  try {
    await page.goto(`${origin}${base}`);
    const create = page.getByRole('button', { name: 'New conversation', exact: true }), input = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(create).toBeEnabled(); await create.click(); await expect(input).toBeEnabled();
    await input.fill('Unsent draft'); await page.setViewportSize({ width: 390, height: 844 }); await expect(input).toHaveValue('Unsent draft');
    await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await create.click(); await page.reload(); await expect(create).toBeEnabled();
    expect(remote.objects.size).toBe(0); expect(remote.requests).toHaveLength(0);
    expect(new URL(page.url()).searchParams.has('session')).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 }); await create.click();
    await input.fill('Canonical first conversation'); await input.press('Enter'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    const library = page.getByRole('navigation', { name: 'Saved conversations' });
    await expect(library.locator('li')).toHaveCount(1);
    await input.fill('Second turn'); await input.press('Enter'); await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect(library.locator('li')).toHaveCount(1); expect(remote.objects.size).toBe(4);
    await create.click(); await expect(library.locator('li')).toHaveCount(1); expect(remote.objects.size).toBe(4);
    await library.getByRole('button', { name: /Canonical first conversation/ }).click();
    await expect(page.getByRole('log')).toContainText('Second turn'); await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); expect(remote.requests).toHaveLength(2);
    await create.click(); await input.fill('Canonical second conversation'); await input.press('Enter'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect(library.locator('li')).toHaveCount(2);
    await library.getByRole('searchbox', { name: 'Search conversations' }).fill('first'); await expect(library.locator('li')).toHaveCount(1);
  } finally { fixture.dispose(); }
});
test('build-pinned runtime bypasses stale unversioned code and the UI deduplicates repeated session rows', async ({ page }) => {
  const remote = remoteFixture(), fixture = await nativeFixture(page, `${origin}${base}`, remote);
  const scripts: string[] = [];
  await page.route('**/extension-runtime.js*', async route => {
    const url = new URL(route.request().url()); scripts.push(url.href);
    if (!url.searchParams.has('build')) { await route.fulfill({ contentType: 'text/javascript', body: 'window.piWebExtension = { protocolVersion: 1 };' }); return; }
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nconst originalList = window.piWebExtension.list; window.piWebExtension.list = async (...args) => { const page = await originalList(...args); return { chats: page.chats.flatMap(chat => [chat, chat]) }; };' });
  });
  try {
    await page.goto(`${origin}${base}`); await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeEnabled();
    expect(scripts).toHaveLength(1); expect(new URL(scripts[0]).searchParams.get('build')).toMatch(/^[a-f0-9]{8}$/);
    expect(await page.evaluate(() => window.piWebExtension.protocolVersion)).toBe(2);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('One canonical row'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect(page.getByRole('navigation', { name: 'Saved conversations' }).locator('li')).toHaveCount(1);
  } finally { fixture.dispose(); }
});
test('incompatible cached runtime fails explicitly instead of showing checkpoint-level rows', async ({ page }) => {
  await page.route('**/extension-runtime.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.piWebExtension = { protocolVersion: 1 };' }));
  await page.goto(`${origin}${base}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Pi Web resources are from different builds.' })).toHaveText('Pi Web resources are from different builds. Reload the page to update.');
  await expect(page.getByRole('navigation', { name: 'Saved conversations' }).locator('li')).toHaveCount(0);
});
test('provider deltas render before completion and the settled transcript restores', async ({ page }) => {
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const remote = remoteFixture(() => gate), fixture = await nativeFixture(page, `${origin}${base}`, remote);
  try {
    await page.goto(`${origin}${base}`); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Stream visibly'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Real Pi reply 1:');
    await expect(page.getByRole('status')).toHaveText('Working…');
    expect(JSON.parse([...remote.objects.values()].at(-1)!.text).phase).toBe('pending');
    resume();
    await expect(page.getByRole('log')).toContainText('Real Pi reply 1: Café 🌴'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await page.reload(); await expect(page.getByRole('log')).toContainText('Real Pi reply 1: Café 🌴'); expect(remote.requests).toHaveLength(1);
  } finally { resume(); fixture.dispose(); }
});
test('production assets contain no canned file manifest and retain provenance', async ({ request }) => {
  expect((await request.get(`${origin}${base}demo-files/manifest.json`)).status()).toBe(404);
  expect((await (await request.get(`${origin}${base}build.json`)).json()).demo).toBe(false);
  expect(await (await request.get(`${origin}${base}PI_WEB_LICENSE.txt`)).text()).toContain('Copyright (c) 2026 agegr');
  expect(await (await request.get(`${origin}${base}THIRD_PARTY_LICENSES.txt`)).text()).toContain('@earendil-works/pi-agent-core@1.5.2');
});

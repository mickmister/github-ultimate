import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('hosted-dist/pi-web');
const welcome = '019d7e3a-5c10-7a41-8f2e-0a1b2c3d4e01';
const files = '019d7e2f-8b44-7c02-9d1a-1b2c3d4e5f02';
let server: Server, origin: string, base: string;
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function recordPageError(errors: string[], error: Error) {
  // WebKit can defer ResizeObserver delivery during rotation. This browser
  // notification is not a script exception; layout and retained state are
  // checked separately below. Keep rejecting every other page error.
  if (error.message === 'ResizeObserver loop completed with undelivered notifications.') return;
  errors.push(error.message);
}

test.beforeAll(async () => {
  const metadata = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8'));
  base = metadata.basePath;
  expect(base).toMatch(/^\/github-ultimate\/previews\/b-.+\/pi-web\/$/);
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    let file = resolve(root, pathname.slice(base.length));
    if (!pathname.startsWith(base) || file !== root && !file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); });

for (const [name, width, height] of [
  ['phone portrait', 390, 844], ['phone landscape', 844, 390],
  ['tablet portrait', 820, 1180], ['tablet landscape', 1180, 820],
  ['desktop portrait', 1080, 1440], ['desktop landscape', 1440, 900],
] as const) {
  test(`${name}: real demo UI, nested assets and draft retention`, async ({ page }) => {
    const errors: string[] = [], failed: string[] = [], api: string[] = [];
    page.on('pageerror', error => recordPageError(errors, error));
    page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}${base}?session=${welcome}`);
    const composer = page.locator('textarea.chat-input-textarea').first();
    await expect(composer).toBeVisible();
    await expect(page.locator('body')).toContainText('Welcome to Pi Web');
    await composer.fill(`Draft for ${name}`);
    await page.setViewportSize({ width: height, height: width });
    await expect(composer).toHaveValue(`Draft for ${name}`);
    await page.setViewportSize({ width, height });
    await expect(composer).toHaveValue(`Draft for ${name}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(new URL(page.url()).pathname).toBe(base);
    expect(errors).toEqual([]); expect(failed).toEqual([]); expect(api).toEqual([]);
  });
}

test('direct session links, refresh, history and simulated tool reply need no backend', async ({ page, request }) => {
  const errors: string[] = [], sockets: string[] = [], api: string[] = [];
  page.on('pageerror', error => recordPageError(errors, error));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto(`${origin}${base}?session=${files}`);
  const composer = page.locator('textarea.chat-input-textarea').first();
  await expect(composer).toBeVisible();
  await expect(page.locator('body')).toContainText('Files, @mentions and diffs');
  await page.reload();
  await expect(composer).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(files);
  await page.goto(`${origin}${base}?session=${welcome}`);
  await expect(page.locator('body')).toContainText('Welcome to Pi Web');
  await page.goBack();
  await expect(composer).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(files);
  await page.goForward();
  await expect(composer).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(welcome);
  await page.getByTitle('Files, @mentions and diffs', { exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBe(files);
  await page.getByTitle('👋 Welcome to Pi Web — a quick tour', { exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBe(welcome);
  await composer.fill('@README.md summarize this');
  await composer.press('Enter');
  await expect(page.getByText('This is a static Pi Web demo: replies are canned and no model is called.', { exact: false })).toBeVisible({ timeout: 30000 });
  const manifest = await (await request.get(`${origin}${base}demo-files/manifest.json`)).json();
  const expected = JSON.parse(await readFile('pi-web/demo/fixtures/files.json', 'utf8')).map((entry: { path: string }) => entry.path).sort();
  expect(manifest.files.map((entry: { path: string }) => entry.path).sort()).toEqual(expected);
  const readme = manifest.files.find((entry: { path: string }) => entry.path === 'README.md');
  expect(await (await request.get(`${origin}${base}demo-files/f/${readme.asset}`)).text()).toContain('explicit public fixture list');
  expect(await (await request.get(`${origin}${base}PI_WEB_LICENSE.txt`)).text()).toContain('Copyright (c) 2026 agegr');
  expect(await (await request.get(`${origin}${base}THIRD_PARTY_LICENSES.txt`)).text()).toContain('@earendil-works/pi-agent-core@1.5.2');
  expect(errors).toEqual([]); expect(sockets).toEqual([]); expect(api).toEqual([]);
});

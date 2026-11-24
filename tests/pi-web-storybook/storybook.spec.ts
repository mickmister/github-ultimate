import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('pi-web/client/storybook-static');
let server: Server, origin: string;
test.beforeAll(async () => {
  if (process.env.PI_WEB_STORYBOOK_PUBLIC_URL) {
    origin = process.env.PI_WEB_STORYBOOK_PUBLIC_URL.replace(/\/$/, '');
    const response = await fetch(`${origin}/build.json`); expect(response.ok).toBe(true);
    const metadata = await response.json(); expect(metadata.kind).toBe('pi-web-storybook'); expect(metadata.storiesOnly).toBe(true);
    if (process.env.PI_WEB_PUBLIC_SHA) expect(metadata.sha).toBe(process.env.PI_WEB_PUBLIC_SHA);
    return;
  }
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  server = createServer(async (request, response) => {
    const path = resolve(root, '.' + new URL(request.url!, 'http://localhost').pathname);
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(404).end(); return; }
    try { const file = (await stat(path)).isDirectory() ? resolve(path, 'index.html') : path; response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); response.end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); });

test('render boundary contains a transcript failure and retries without losing the composer', async ({ page }) => {
  await page.goto(`${origin}/iframe.html?id=pi-web-error-recovery--transcript&viewMode=story`);
  const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('Keep my unsent draft');
  await page.getByRole('button', { name: 'Break renderer', exact: true }).click();
  await expect(page.getByRole('alert', { name: 'conversation display error' })).toBeVisible();
  await expect(input).toHaveValue('Keep my unsent draft'); await input.fill('Still usable after failure');
  await page.getByRole('button', { name: 'Repair renderer', exact: true }).click();
  await page.getByRole('button', { name: 'Retry display', exact: true }).click();
  await expect(page.getByText('Conversation is visible.', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Still usable after failure'); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('separate Storybook manager opens the production chat story', async ({ page }) => {
  await page.goto(`${origin}/?path=/story/pi-web-chat--conversation`);
  await expect(page.frameLocator('#storybook-preview-iframe').getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

for (const [id, text] of [
  ['pi-web-chat--conversation', 'Browser conversation architecture'], ['pi-web-chat--draft', 'What can I help you with?'],
  ['pi-web-chat--tool-calls', 'Inspect the project'], ['pi-web-chat--interrupted', 'previous turn was interrupted'],
  ['pi-web-chat--save-error', 'Storage is unavailable'], ['pi-web-chat--phone', 'Browser conversation architecture'],
  ['pi-web-chat--tablet', 'Browser conversation architecture'], ['pi-web-messages--markdown-and-code', 'Browser conversations'],
  ['pi-web-messages--thinking-and-tools', 'Inspect the project'], ['pi-web-messages--streaming', 'incrementally'],
  ['pi-web-messages--provider-error', 'inference endpoint is unavailable'],
  ['pi-web-messages--deferred-host-content', 'view full output'],
]) test(`${id}: renders original UI without remote services`, async ({ page }, testInfo) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story`);
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  if (id === 'pi-web-chat--conversation') {
    expect(await page.locator('.chat-library').evaluate(element => element.getBoundingClientRect().width)).toBe(280);
    await expect(page.locator('.chat-composer')).toHaveCSS('border-top-left-radius', '18px');
    await page.screenshot({ path: testInfo.outputPath('original-style-chat.png') });
  }
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});
test('deferred renderer content uses injected host loaders without Node API calls', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto(`${origin}/iframe.html?id=pi-web-messages--deferred-host-content&viewMode=story`);
  const thinking = page.getByRole('button', { name: /^Thinking/ });
  if (await thinking.getAttribute('aria-expanded') !== 'true') await thinking.click();
  await expect(page.getByText('Full thinking supplied by the owning host.')).toBeVisible();
  await page.getByRole('button', { name: 'view full output' }).click();
  await page.getByRole('button', { name: /^bash / }).click();
  await expect(page.getByText('Complete output supplied by the owning host.')).toBeVisible();
  expect(requests).toEqual([]);
});
test('retained thinking/tool cards expand results, sidebar toggles and composer stays usable on phone', async ({ page }) => {
  await page.goto(`${origin}/iframe.html?id=pi-web-chat--tool-calls&viewMode=story`);
  await page.getByRole('button', { name: /^read / }).click();
  await expect(page.getByText('export function newConversation()', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^bash / }).click();
  await expect(page.getByText('Test failed: expected no saved conversation before first send.')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle light and dark theme' }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/iframe.html?id=pi-web-chat--phone&viewMode=story`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A draft in the original composer');
  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Saved conversations' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide conversations' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('A draft in the original composer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

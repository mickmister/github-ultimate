import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';

test('packaged extension runs a real Pi conversation, keeps credentials private and cancels inference', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium loads the packaged extension; WebKit covers the static UI.');
  test.setTimeout(120000);
  const profile = await mkdtemp(resolve(tmpdir(), 'pi-web-extension-'));
  let context: BrowserContext | undefined;
  try {
    const extension = resolve(profile, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://agent.example/*', 'https://inference.example/*');
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      const state = globalThis as typeof globalThis & { requests: unknown[]; cancelled: boolean };
      state.requests = []; state.cancelled = false;
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (!request.url.startsWith('https://inference.example/')) throw Error('Unexpected network request');
        if (request.headers.get('authorization') !== 'Bearer private-fixture-secret') return Response.json({}, { status: 401 });
        const body = await request.json(); state.requests.push(body);
        const messages = body.messages.filter((m: { role: string }) => m.role === 'user');
        if (messages.at(-1).content === 'Simulate provider failure') return Response.json({ error: 'private-fixture-secret' }, { status: 401 });
        if (messages.at(-1).content === 'Wait for cancellation') return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => { state.cancelled = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: `Extension reply ${messages.length}: Café 🌴` } }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } });
      };
    });
    const root = resolve('hosted-dist/pi-web'), metadata = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8')), base = metadata.basePath;
    await context.route('https://agent.example/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith(base)) return route.fulfill({ status: 404 });
      let file = resolve(root, path.slice(base.length));
      if (file !== root && !file.startsWith(root + '/')) return route.fulfill({ status: 404 });
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
        const contentType = ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)];
        return route.fulfill({ path: file, ...(contentType ? { contentType } : {}) });
      } catch { return route.fulfill({ status: 404 }); }
    });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${worker.url().split('/')[2]}/connections.html`);
    await settings.getByLabel('Inference connection name').fill('Pi Web test');
    await settings.getByLabel('Inference URL', { exact: true }).fill('https://inference.example/v1/chat/completions');
    await settings.getByLabel('Inference model', { exact: true }).fill('test-model');
    await settings.getByLabel('Inference HTTP headers').fill('{"Authorization":"Bearer private-fixture-secret"}');
    await settings.getByRole('button', { name: 'Save inference connection', exact: true }).click();
    const card = settings.getByRole('article', { name: 'Pi Web test', exact: true });
    const page = await context.newPage(); await page.goto('https://agent.example' + base);
    await page.getByRole('button', { name: 'Connect inference', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No bridge response' })).toBeVisible({ timeout: 35000 });
    await card.getByLabel('Inference hosted origin').fill('https://agent.example');
    await card.getByLabel('Inference hosted subpath').fill(base);
    await card.getByRole('button', { name: 'Grant inference access', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Connect inference', exact: true }).click();
    await expect(page.getByLabel('Inference connection', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New real Pi session', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Real Pi session:' })).toBeVisible();
    await page.waitForURL(url => Boolean(url.searchParams.get('session')) && url.searchParams.get('session') !== '019d7e3a-5c10-7a41-8f2e-0a1b2c3d4e01');
    const input = page.locator('textarea.chat-input-textarea').first();
    await input.fill('Hello from Pi Web'); await input.press('Enter');
    await expect(page.locator('body')).toContainText('Extension reply 1: Café 🌴');
    await input.fill('Continue our conversation'); await input.press('Enter');
    await expect(page.locator('body')).toContainText('Extension reply 2: Café 🌴');
    const requests = await worker.evaluate(() => (globalThis as unknown as { requests: { messages: { role: string; content: string }[]; tools?: unknown }[] }).requests);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toContainEqual({ role: 'assistant', content: 'Extension reply 1: Café 🌴' });
    expect(requests[1].tools).toBeUndefined();
    expect(await page.content()).not.toContain('private-fixture-secret');
    const shell = await page.evaluate(async () => {
      const id = new URL(location.href).searchParams.get('session');
      return (await fetch(`/api/agent/${id}`, { method: 'POST', body: JSON.stringify({ type: 'bash', command: 'pwd' }) })).json();
    });
    expect(shell.error).toContain('Not supported');
    await input.fill('Simulate provider failure'); await input.press('Enter');
    await expect(page.locator('body')).toContainText('Inference returned HTTP 401');
    expect(await page.content()).not.toContain('private-fixture-secret');
    await input.fill('Wait for cancellation'); await input.press('Enter');
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { requests: unknown[] }).requests.length)).toBe(4);
    await page.getByRole('button', { name: /Stop/, exact: false }).first().click();
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { cancelled: boolean }).cancelled)).toBe(true);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

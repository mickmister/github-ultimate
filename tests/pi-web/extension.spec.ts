import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { remoteFixture } from './native-fixture';

test('packaged extension saves and restores real Pi chats through signed versioned S3', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium loads the packaged extension; WebKit verifies the native wire adapter.');
  test.setTimeout(120000);
  const profile = await mkdtemp(resolve(tmpdir(), 'pi-web-extension-')), remote = remoteFixture();
  let context: BrowserContext | undefined;
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      let text = ''; for await (const chunk of incoming) text += chunk;
      const input = JSON.parse(text);
      const response = await remote.fetcher(input.url, { method: input.method, headers: input.headers, ...(input.body ? { body: Buffer.from(input.body, 'base64') } : {}) });
      outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ status: response.status, headers: [...response.headers], body: Buffer.from(await response.arrayBuffer()).toString('base64') }));
    } catch { outgoing.writeHead(500).end(); }
  });
  await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done));
  const endpoint = `http://127.0.0.1:${(proxy.address() as { port: number }).port}/`;
  try {
    const extension = resolve(profile, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://agent.example/*', 'https://inference.example/*', 'https://s3.us-west-004.backblazeb2.com/*', 'http://127.0.0.1/*');
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(endpoint => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        let binary = ''; if (!['GET', 'HEAD'].includes(request.method)) { const bytes = new Uint8Array(await request.arrayBuffer()); for (const byte of bytes) binary += String.fromCharCode(byte); }
        const proxy = await original(endpoint, { method: 'POST', body: JSON.stringify({ url: request.url, method: request.method, headers: [...request.headers], body: binary ? btoa(binary) : undefined }), signal: request.signal });
        const result = await proxy.json();
        return new Response(Uint8Array.from(atob(result.body), character => character.charCodeAt(0)), { status: result.status, headers: result.headers });
      };
    }, endpoint);
    const root = resolve('hosted-dist/pi-web'), base = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8')).basePath;
    await context.route('https://agent.example/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith(base)) return route.fulfill({ status: 404 });
      let file = resolve(root, path.slice(base.length));
      if (file !== root && !file.startsWith(root + '/')) return route.fulfill({ status: 404 });
      try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); return route.fulfill({ path: file, contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] }); }
      catch { return route.fulfill({ status: 404 }); }
    });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${worker.url().split('/')[2]}/connections.html`);
    await settings.getByLabel('Inference connection name').fill('Pi model'); await settings.getByLabel('Inference URL', { exact: true }).fill('https://inference.example/chat');
    await settings.getByLabel('Inference model', { exact: true }).fill('fixture-model'); await settings.getByLabel('Inference HTTP headers').fill('{"Authorization":"Bearer private-fixture-secret"}');
    await settings.getByRole('button', { name: 'Save inference connection', exact: true }).click();
    const inference = settings.getByRole('article', { name: 'Pi model', exact: true });
    await inference.getByLabel('Inference hosted origin').fill('https://agent.example'); await inference.getByLabel('Inference hosted subpath').fill(base); await inference.getByRole('button', { name: 'Grant inference access', exact: true }).click();
    await settings.getByLabel('S3 connection name').fill('Shared chats'); await settings.getByLabel('S3 endpoint', { exact: true }).fill('https://s3.us-west-004.backblazeb2.com');
    await settings.getByLabel('S3 bucket', { exact: true }).fill('chats'); await settings.getByLabel('S3 signing region').fill('us-west-004'); await settings.getByLabel('S3 allowed key prefix').fill('workspace/');
    await settings.getByLabel('S3 access key ID').fill('private-key'); await settings.getByLabel('S3 secret access key').fill('private-s3-secret'); await settings.getByRole('button', { name: 'Save S3 connection', exact: true }).click();
    const storage = settings.getByRole('article', { name: 'Shared chats', exact: true });
    await storage.getByLabel('S3 hosted origin').fill('https://agent.example'); await storage.getByLabel('S3 hosted subpath').fill(base); await storage.getByRole('button', { name: 'Grant hosted S3 access' }).click();
    const page = await context.newPage(); await page.goto(`https://agent.example${base}`);
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'New conversation', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello through extension'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Real Pi reply 1'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await page.reload(); await expect(page.getByRole('log')).toContainText('Real Pi reply 1'); expect(remote.requests).toHaveLength(1);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue after reload'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    expect(remote.requests[1].messages).toContainEqual({ role: 'assistant', content: 'Real Pi reply 1: Café 🌴' });
    expect(await page.content()).not.toMatch(/private-fixture-secret|private-s3-secret/);
    expect(new URL(page.url()).searchParams.get('checkpoint')).toContain('#versionId=');
    await settings.getByRole('button', { name: `Revoke S3 grant https://agent.example${base}`, exact: true }).click();
    const before = remote.requests.length;
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Must not call inference'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not approved' })).toBeVisible(); expect(remote.requests).toHaveLength(before);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); await new Promise<void>(done => proxy.close(() => done())); }
});

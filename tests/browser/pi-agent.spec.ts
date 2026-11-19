import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('packaged extension keeps inference headers private, runs Pi/GitHub tools and restores an immutable S3 session after reload', async () => {
  const profile = await mkdtemp(resolve(tmpdir(), 'pi-browser-'));
  let context: BrowserContext | undefined;
  try {
    const extension = resolve(profile, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://agent.example/*', 'https://inference.example/*', 'https://s3.example/*');
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    const worker: Worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const grant = [{ origin: 'https://agent.example', subpath: '/poc/' }];
      const records = {
        connections: { id: '11111111-1111-4111-8111-111111111111', name: 'Test GitHub', appId: 123, clientId: 'test', user: { id: 42, login: 'tester' }, installation: { id: 456, account: 'tester' }, tokens: { accessToken: 'private-github-token', expiresAt: Date.now() + 86400000 }, hostedGrants: grant },
        s3Connections: { id: '22222222-2222-4222-8222-222222222222', revision: '33333333-3333-4333-8333-333333333333', name: 'Test sessions', endpoint: 'https://s3.example/', region: 'auto', bucket: 'sessions', addressing: 'path', prefix: 'private/', accessKeyId: 'private-s3-key', secretAccessKey: 'private-s3-secret', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: grant },
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('github-ultimate-credentials', 4); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction(Object.keys(records), 'readwrite'); for (const [name, record] of Object.entries(records)) tx.objectStore(name).put(record); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
      const network = globalThis as typeof globalThis & { __piRequests: { url: string; body?: any; headers: Record<string, string> }[]; __piObjects: Record<string, string> };
      network.__piRequests = []; network.__piObjects = {};
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init), url = new URL(request.url), headers = Object.fromEntries(request.headers);
        const raw = request.method === 'POST' || request.method === 'PUT' ? await request.text() : undefined;
        network.__piRequests.push({ url: request.url, body: url.hostname === 'inference.example' ? JSON.parse(raw!) : undefined, headers });
        if (url.hostname === 'inference.example') {
          if (headers.authorization !== 'Bearer private-inference-secret' || headers['x-custom'] !== 'private-custom-secret') return Response.json({}, { status: 401 });
          const body = JSON.parse(raw!);
          if (body.messages.at(-1).role === 'user' && !body.messages.some((message: any) => message.role === 'tool')) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'browser-call-1', type: 'function', function: { name: 'github_probe', arguments: '{"repository":"owner/repo"}' } }] } }] });
          return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Verified repository head. Café 🌴' } }] });
        }
        if (url.hostname === 'api.github.com') {
          if (headers.authorization !== 'Bearer private-github-token') return Response.json({}, { status: 401 });
          if (url.pathname === '/user/installations/456/repositories') return Response.json({ repositories: [{ full_name: 'owner/repo', private: true, default_branch: 'main' }] });
          if (url.pathname === '/repos/owner/repo/git/ref/heads/main') return Response.json({ object: { type: 'commit', sha: 'a'.repeat(40) } });
        }
        if (url.hostname === 's3.example') {
          if (!headers.authorization?.startsWith('AWS4-HMAC-SHA256')) return new Response('', { status: 403 });
          const key = decodeURIComponent(url.pathname.slice('/sessions/'.length));
          if (request.method === 'PUT') {
            if (headers['if-none-match'] !== '*' || key in network.__piObjects) return new Response('', { status: 412 });
            network.__piObjects[key] = raw!; return new Response('', { headers: { ETag: '"checkpoint"' } });
          }
          if (url.searchParams.has('list-type')) return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated><EncodingType>url</EncodingType>${Object.entries(network.__piObjects).filter(([key]) => key.startsWith(url.searchParams.get('prefix')!)).map(([key, value]) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${new TextEncoder().encode(value).length}</Size></Contents>`).join('')}</ListBucketResult>`);
          if (key in network.__piObjects) return new Response(network.__piObjects[key], { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('', { status: 404 });
      };
    });
    await context.route('https://agent.example/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
      if (!/^(pi\.html|pi-[A-Z0-9]+\.(js|css))$/.test(name)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${worker.url().split('/')[2]}/connections.html`);
    await settings.getByLabel('Inference connection name').fill('Test inference');
    await settings.getByLabel('Inference URL', { exact: true }).fill('https://inference.example/v1/chat/completions');
    await settings.getByLabel('Inference model', { exact: true }).fill('test-model');
    await settings.getByLabel('Inference HTTP headers').fill('{"Authorization":"Bearer private-inference-secret","X-Custom":"private-custom-secret"}');
    await settings.getByRole('button', { name: 'Save inference connection', exact: true }).click();
    const card = settings.getByRole('article', { name: 'Test inference', exact: true });
    await card.getByLabel('Inference hosted origin').fill('https://agent.example'); await card.getByLabel('Inference hosted subpath').fill('/poc/');
    await card.getByRole('button', { name: 'Grant inference access', exact: true }).click();
    await expect(settings.locator('#inference-status')).toContainText('Inference access granted');
    const page = await context.newPage(); await page.goto('https://agent.example/poc/pi.html');
    await page.getByRole('button', { name: 'Load approved connections' }).click();
    await expect(page.locator('#pi-status')).toContainText('Choose all three connections');
    await page.getByLabel('Inference connection', { exact: true }).selectOption({ label: 'Test inference' });
    await page.getByLabel('GitHub connection', { exact: true }).selectOption({ label: 'Test GitHub' });
    await page.getByLabel('S3 session storage').selectOption({ label: 'Test sessions' });
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    await expect(page.locator('#pi-status')).toContainText('Saved and readback-verified');
    const sessionId = await page.getByLabel('Session ID').inputValue();
    await page.getByLabel('Message', { exact: true }).fill('Read owner/repo'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('Verified repository head. Café 🌴');
    await expect(page.locator('#pi-status')).toContainText('Saved and readback-verified');
    expect(await page.content()).not.toMatch(/private-inference-secret|private-custom-secret|private-github-token|private-s3-secret/);
    const before = await worker.evaluate(() => (globalThis as any).__piRequests.filter((item: any) => item.url.includes('inference.example')).length);
    expect(before).toBe(2);
    await page.reload(); await page.getByRole('button', { name: 'Load approved connections' }).click();
    await page.getByLabel('Inference connection', { exact: true }).selectOption({ label: 'Test inference' }); await page.getByLabel('GitHub connection', { exact: true }).selectOption({ label: 'Test GitHub' }); await page.getByLabel('S3 session storage').selectOption({ label: 'Test sessions' });
    await page.getByLabel('Session ID').fill(sessionId); await page.getByRole('button', { name: 'List checkpoints', exact: true }).click();
    await expect(page.locator('#checkpoint option')).toHaveCount(2);
    const keys = await page.locator('#checkpoint option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
    await page.getByLabel('Saved checkpoint').selectOption(keys.sort().at(-1)!); await page.getByRole('button', { name: 'Restore checkpoint', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('Café 🌴');
    await page.getByLabel('Message', { exact: true }).fill('Continue from that result'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#pi-status')).toContainText('Saved and readback-verified');
    const requests = await worker.evaluate(() => (globalThis as any).__piRequests.filter((item: any) => item.url.includes('inference.example')));
    expect(requests).toHaveLength(3); expect(requests[2].body.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'browser-call-1' }));
    await card.getByRole('button', { name: 'Revoke inference access', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Revoke inference access', exact: true })).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('Try after revocation'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('Inference connection access changed');
    expect(await worker.evaluate(() => (globalThis as any).__piRequests.filter((item: any) => item.url.includes('inference.example')).length)).toBe(3);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

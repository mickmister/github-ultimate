import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('packaged settings connect ChatGPT, resume device login and retain custom endpoints; production runtime saves/restores Responses', async () => {
  test.setTimeout(60000);
  const profile = await mkdtemp(resolve(tmpdir(), 'chatgpt-extension-'));
  let context: BrowserContext | undefined;
  try {
    const extension = resolve(profile, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://auth.openai.com/*', 'https://chatgpt.com/*', 'https://agent.example/*', 'https://storage.example/*', 'https://custom.example/*');
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const state = globalThis as any;
      state.__approved = false; state.__requests = []; state.__objects = {};
      const token = `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'private-account' } }))}.private-access`;
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('github-ultimate-credentials', 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('s3Connections', 'readwrite');
        tx.objectStore('s3Connections').put({ id: '22222222-2222-4222-8222-222222222222', revision: '33333333-3333-4333-8333-333333333333', name: 'Sessions', endpoint: 'https://storage.example/', region: 'us-east-1', bucket: 'sessions', addressing: 'path', prefix: '', accessKeyId: 's3-private-key', secretAccessKey: 's3-private-secret', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [{ origin: 'https://agent.example', subpath: '/' }] });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); db.close();
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init), url = new URL(request.url), raw = ['POST', 'PUT'].includes(request.method) ? await request.text() : '';
        state.__requests.push({ url: request.url, body: raw, headers: Object.fromEntries(request.headers) });
        if (url.pathname.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'private-device-id', user_code: 'BROW-SER1', interval: 1 });
        if (url.pathname.endsWith('/deviceauth/token')) return state.__approved ? Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' }) : Response.json({}, { status: 403 });
        if (url.pathname === '/oauth/token') return Response.json({ access_token: token, refresh_token: 'private-refresh', expires_in: 3600 });
        if (url.hostname === 'chatgpt.com') {
          if (request.headers.get('authorization') !== `Bearer ${token}` || request.headers.get('chatgpt-account-id') !== 'private-account') return Response.json({}, { status: 401 });
          const events = [
            { type: 'response.created', response: { id: 'resp_browser' } },
            { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_browser', role: 'assistant', content: [] } },
            { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'ChatGPT connected 🌴' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_browser', role: 'assistant', content: [{ type: 'output_text', text: 'ChatGPT connected 🌴', annotations: [] }] } },
            { type: 'response.completed', response: { id: 'resp_browser', status: 'completed', usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
          ];
          return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
        }
        if (url.hostname === 'storage.example') {
          const key = decodeURIComponent(url.pathname.slice('/sessions/'.length));
          if (request.method === 'PUT') { state.__objects[key] = raw; return new Response(''); }
          if (url.searchParams.has('list-type')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
          if (key in state.__objects) return new Response(state.__objects[key]);
        }
        return new Response('', { status: 404 });
      };
    });
    const runtime = await readFile(resolve('hosted-dist/pi-web/extension-runtime.js'), 'utf8');
    await context.route('https://agent.example/**', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.js') ? runtime : '<!doctype html><script type="module" src="/runtime.js"></script>' }));
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${worker.url().split('/')[2]}/connections.html`);
    await settings.getByLabel('Inference connection name', { exact: true }).fill('Existing endpoint');
    await settings.getByLabel('Inference URL', { exact: true }).fill('https://custom.example/v1/chat/completions');
    await settings.getByLabel('Inference model', { exact: true }).fill('custom-model');
    await settings.getByRole('button', { name: 'Save inference connection', exact: true }).click();
    await expect(settings.getByRole('article', { name: 'Existing endpoint' })).toBeVisible();
    await settings.getByRole('button', { name: 'Connect to ChatGPT', exact: true }).click();
    let card = settings.getByRole('article', { name: 'ChatGPT', exact: true });
    await expect(card).toContainText('BROW-SER1'); await settings.reload();
    card = settings.getByRole('article', { name: 'ChatGPT', exact: true });
    await expect(card).toContainText('BROW-SER1');
    await expect(card.getByRole('link', { name: 'Open ChatGPT verification' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
    await worker.evaluate(() => { (globalThis as any).__approved = true; });
    await expect(card).toContainText('ChatGPT · connected');
    await expect(settings.getByRole('article', { name: 'Existing endpoint' })).toBeVisible();
    expect(await settings.content()).not.toMatch(/private-access|private-refresh|private-verifier|private-device-id/);
    await card.getByLabel('Inference hosted origin').fill('https://agent.example');
    await card.getByRole('button', { name: 'Grant inference access', exact: true }).click();
    const page = await context.newPage(); await page.goto('https://agent.example/');
    await page.waitForFunction(() => !!window.piWebExtension);
    const result = JSON.parse(await page.evaluate(async () => {
      const api = window.piWebExtension, connections = await api.connections();
      const inference = connections.inference.find(c => c.provider === 'chatgpt')!, storage = connections.storage[0];
      const chat = api.create(inference, storage); await chat.send('Hello ChatGPT');
      const snapshot = chat.snapshot();
      return JSON.stringify({ connections, snapshot });
    }));
    expect(result.snapshot.messages.at(-1)).toMatchObject({ api: 'openai-codex-responses', stopReason: 'stop', content: [{ type: 'text', text: 'ChatGPT connected 🌴', textSignature: expect.any(String) }] });
    expect(result.snapshot.dirty).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private-access|private-refresh|private-account|private-code|private-verifier/);
    await page.reload(); await page.waitForFunction(() => !!window.piWebExtension);
    const restored = JSON.parse(await page.evaluate(async ({ sessionId, reference }: { sessionId: string; reference: string }) => {
      const api = window.piWebExtension, connections = await api.connections();
      const chat = await api.restore(connections.inference.find(c => c.provider === 'chatgpt')!, connections.storage[0], sessionId!, reference!);
      await chat.send('Continue after reload'); return JSON.stringify(chat.snapshot());
    }, { sessionId: result.snapshot.sessionId, reference: result.snapshot.reference }));
    expect(restored.dirty).toBe(false); expect(restored.messages.at(-1)).toMatchObject({ stopReason: 'stop' });
    const objects = await worker.evaluate(() => JSON.stringify((globalThis as any).__objects));
    expect(objects).not.toMatch(/private-access|private-refresh|private-verifier|private-device-id|private-account/);
    await card.getByRole('button', { name: 'Disconnect ChatGPT', exact: true }).click();
    await expect(card).toContainText('ChatGPT · disconnected');
    expect(await worker.evaluate(() => (globalThis as any).__requests.filter((r: any) => r.url.includes('/codex/responses')).length)).toBe(2);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

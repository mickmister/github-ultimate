import { test, expect, chromium } from '@playwright/test';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { liveProducerFixture } from './live-producer.fixture';

test('packaged extension follows private signed S3 batches in the production app and treats absent tails as pending', async () => {
  test.setTimeout(120000);
  const producer = process.env.PI_LIVE_PRODUCER_ROOT ? await liveProducerFixture(process.env.PI_LIVE_PRODUCER_ROOT) : undefined;
  const profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-live-')), extension = resolve(profile, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://apps.example.test/*', 'https://s3.us-west-004.backblazeb2.com/*');
  if (producer) { const endpoint = new URL(producer.endpoint); manifest.host_permissions.push(`${endpoint.protocol}//${endpoint.hostname}/*`); }
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2], root = resolve('hosted-dist/app'), html = await readFile(resolve(root, 'index.html'), 'utf8');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)![1], base = script.slice(0, script.indexOf('/assets/') + 1);
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm' };
    await context.route('https://apps.example.test/**', async route => {
      const path = new URL(route.request().url()).pathname, file = resolve(root, path.slice(base.length) || 'index.html');
      if (!path.startsWith(base) || !file.startsWith(root + '/')) return route.fulfill({ status: 404 });
      try { await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    const binding = { workspace: 'demo', workspace_ref: 'ws-' + '1'.repeat(32), process: 'pilot', bead: 'task-live' }, storageRoot = 'private/qrspi-hosted/';
    const prefix = producer?.prefix ?? storageRoot + 'processes/' + 'a'.repeat(64) + '/executions/123-1/work/', locatorKey = storageRoot + 'live/owner/storage/demo/123-1/work.json';
    const locator = { kind: 'pi-live-locator', schemaVersion: 1, binding, storageRepository: 'owner/storage', repository: 'owner/engine', executionId: '123-1', command: 'work', sourceSha: 'b'.repeat(40), piVersion: '1.5.2', createdAt: new Date().toISOString(), evidencePrefix: prefix };
    if (!producer) await worker.evaluate(({ locatorKey, locator }) => {
      const state = globalThis as typeof globalThis & { __liveObjects: Map<string, string>; __liveRequests: { key: string; signed: boolean }[] };
      state.__liveObjects = new Map([[locatorKey, JSON.stringify(locator)]]); state.__liveRequests = [];
      globalThis.fetch = async (input, init) => {
        const request = input as Request, url = new URL(request.url);
        if (url.origin !== 'https://s3.us-west-004.backblazeb2.com' || request.method !== 'GET') throw Error('Unexpected live transport');
        const signed = request.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=LIVEACCESS/') ?? false;
        if (!signed || init?.cache !== 'no-store' || init?.credentials !== 'omit') return new Response('', { status: 403 });
        const key = decodeURIComponent(url.pathname.slice('/live-bucket/'.length)); state.__liveRequests.push({ key, signed });
        if (url.searchParams.get('list-type') === '2') {
          const prefix = url.searchParams.get('prefix')!;
          const items = [...state.__liveObjects].filter(([key]) => key.startsWith(prefix)).map(([key, text]) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${new TextEncoder().encode(text).length}</Size></Contents>`).join('');
          return new Response(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
        }
        return state.__liveObjects.has(key) ? new Response(state.__liveObjects.get(key), { headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 });
      };
    }, { locatorKey, locator });
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
    await settings.getByLabel('S3 connection name').fill('Live Actions');
    await settings.getByLabel('S3 endpoint', { exact: true }).fill(producer?.endpoint ?? 'https://s3.us-west-004.backblazeb2.com');
    await settings.getByLabel('S3 bucket', { exact: true }).fill('live-bucket');
    await settings.getByLabel('S3 signing region').fill('us-west-004');
    await settings.getByLabel('S3 allowed key prefix').fill('private/');
    await settings.getByLabel('Allow uploads', { exact: true }).uncheck();
    await settings.getByLabel('S3 access key ID').fill('LIVEACCESS');
    await settings.getByLabel('S3 secret access key').fill('private-live-secret');
    await settings.getByRole('button', { name: 'Save S3 connection', exact: true }).click();
    const card = settings.getByRole('article', { name: 'Live Actions', exact: true });
    await card.getByLabel('S3 hosted origin').fill('https://apps.example.test');
    await card.getByLabel('S3 hosted subpath').fill(base);
    await card.getByRole('button', { name: 'Grant hosted S3 access' }).click();
    await expect(settings.locator('#s3-status')).toContainText('grant saved');
    const page = await context.newPage(); await page.goto(`https://apps.example.test${base}#/agent?repository=owner%2Fstorage&workspace=demo`);
    await page.getByRole('button', { name: 'Load Actions storage', exact: true }).click();
    await page.getByLabel('Actions S3 connection').selectOption({ label: 'Live Actions' });
    await page.getByLabel('Actions storage root').fill(storageRoot);
    await page.getByRole('button', { name: 'Find remote sessions', exact: true }).click();
    await page.getByLabel('Remote session', { exact: true }).selectOption(locatorKey);
    await page.getByRole('button', { name: 'Follow session', exact: true }).click();
    await expect(page.getByText('Following · read-only', { exact: true })).toBeVisible();
    const row = (sequence: number, event: unknown) => ({ schemaVersion: 1, sequence, timestamp: new Date().toISOString(), kind: 'pi', sessionId: 'parent', data: { source: 'pi-events.log', event } });
    const chunk = (events: unknown[]) => ({ schemaVersion: 1, binding, executionId: '123-1', phaseApproval: false, replayAuthorized: false, events });
    const publish = async (entries: [string, unknown][]) => worker.evaluate(entries => {
      const state = globalThis as typeof globalThis & { __liveObjects: Map<string, string> };
      for (const [key, value] of entries) state.__liveObjects.set(key, JSON.stringify(value));
    }, entries);
    if (producer) producer.start();
    else await publish([[prefix + 'chunks/000001.json', chunk([
      row(1, { type: 'message_start', message: { role: 'assistant', content: [] } }),
      row(2, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Private live batch arrived' } }),
    ])]]);
    await expect(page.locator('.agent-remote-transcript')).toContainText('Private live batch arrived', { timeout: 12000 });
    const partialVisibleAt = Date.now();
    await expect(page.getByText('Invocation completed · read-only', { exact: true })).toHaveCount(0);
    if (producer) await producer.finish();
    else await publish([
      [prefix + 'chunks/000002.json', chunk([row(3, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Private final result' }] } })])],
      [prefix + 'terminal.json', { kind: 'pi-live-terminal', schemaVersion: 1, binding, executionId: '123-1', command: 'work', status: 'completed', chunks: 2, sequence: 3, finishedAt: new Date().toISOString(), phaseApproval: false }],
    ]);
    await expect(page.getByText('Invocation completed · read-only', { exact: true })).toBeVisible({ timeout: 15000 });
    const roles = await page.locator('.agent-remote-transcript article > strong').allTextContents();
    expect(roles.filter(role => role === 'assistant')).toHaveLength(1);
    if (producer) { expect(roles.filter(role => role === 'user')).toHaveLength(1); expect(roles.filter(role => role === 'system').length).toBeLessThanOrEqual(1); }
    else expect(roles).toEqual(['assistant']);
    await expect(page.locator('.agent-remote-transcript')).toContainText('Private final result');
    expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toMatch(/private-live-secret|LIVEACCESS|Private final result/);
    expect(await page.locator('body').innerText()).not.toMatch(/private-live-secret|LIVEACCESS/);
    const calls = producer?.calls ?? await worker.evaluate(() => (globalThis as typeof globalThis & { __liveRequests: { key: string; signed: boolean }[] }).__liveRequests);
    expect(calls.every(call => call.signed)).toBe(true); expect(calls.some(call => call.key.includes('chunks/'))).toBe(true);
    if (!producer) expect(calls.some(call => call.key.endsWith('chunks/000003.json'))).toBe(true);
    if (producer) {
      expect(producer.calls.some(call => call.actor === 'producer' && call.method === 'PUT')).toBe(true);
      expect(producer.calls.some(call => call.actor === 'viewer' && call.method === 'GET')).toBe(true);
      console.info(JSON.stringify({ fixtureOnly: true, partialPublishToVisibleMs: partialVisibleAt - producer.partialPublishedAt(),
        producerPuts: producer.calls.filter(c => c.actor === 'producer' && c.method === 'PUT').length,
        producerReads: producer.calls.filter(c => c.actor === 'producer' && c.method === 'GET').length,
        viewerReads: producer.calls.filter(c => c.actor === 'viewer' && c.method === 'GET').length }));
    }
  } finally { await context.close(); await producer?.dispose(); await rm(profile, { recursive: true, force: true }); }
});

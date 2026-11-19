import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { createServer as createHttpServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pageChannel, replyChannel, hostedRelayRevision } from '../../src/bridge-channels';
import { Scratch } from '../../src/scratch';

let server: ViteDevServer | undefined, staticServer: Server | undefined, origin: string;
test.beforeAll(async () => {
  if (process.env.TEST_BUILT_ASSETS) {
    const root = resolve('hosted-dist/app'), html = await readFile(resolve(root, 'index.html'), 'utf8');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)![1], base = script.slice(0, script.indexOf('/assets/') + 1);
    const types: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm' };
    staticServer = createHttpServer(async (request, response) => {
      const path = new URL(request.url!, 'http://local.test').pathname, file = resolve(root, path.slice(base.length) || 'index.html');
      if (!path.startsWith(base) || !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
      try { response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(done => staticServer!.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${(staticServer.address() as { port: number }).port}${base}`;
  } else { server = await createServer({ root: resolve('webapp'), configFile: resolve('webapp/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } }); await server.listen(); origin = server.resolvedUrls!.local[0]; }
});
test.afterAll(async () => { await server?.close(); if (staticServer) await new Promise<void>(done => staticServer!.close(() => done())); });
async function mockBridge(page: Page) {
  const objects = new Map<string, string>(), revision = crypto.randomUUID(); let inferenceCalls = 0;
  const initial = new Scratch({ version: 1, revision: 0, origin: { repository: 'owner/repo', commit: 'a'.repeat(40), directory: 'docs' }, files: [{ path: 'README.md', content: 'Pinned original\n', mode: '100644' }], commits: [] });
  initial.commit('Pinned import', 0, null, 0);
  await page.exposeFunction('agentTestBridge', async (request: any) => {
    if (request.operation === 'inferenceConnections') return [{ id: 'inference', revision, name: 'Test inference', model: 'test-model', hostedGrants: [] }];
    if (request.operation === 'connections') return [{ id: 'github', name: 'Test GitHub', appId: 1, user: { id: 2, login: 'tester' }, installation: { id: 3, account: 'tester' } }];
    if (request.operation === 's3Connections') return [{ id: 'storage', revision, name: 'Test S3', endpoint: 'https://s3.example/', bucket: 'sessions', prefix: 'private/', region: 'auto', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false }];
    if (request.operation === 'agentSnapshot') { expect(request).toMatchObject({ repository: 'owner/repo', commit: 'a'.repeat(40), directory: 'docs' }); return initial.snapshot(); }
    if (request.operation === 's3Upload') { if (objects.has(request.key)) throw Error('Overwrite denied'); objects.set(request.key, Buffer.from(request.base64, 'base64').toString('utf8')); return { key: request.key }; }
    if (request.operation === 's3Read') { const body = objects.get(request.key)!; return { key: request.key, size: Buffer.byteLength(body), base64: Buffer.from(body).toString('base64') }; }
    if (request.operation === 's3List') return { objects: [...objects].filter(([key]) => key.startsWith(request.prefix)).map(([key, body]) => ({ key, size: Buffer.byteLength(body) })) };
    if (request.operation === 'inferenceComplete') {
      inferenceCalls++;
      const call = (name: string, args: unknown) => ({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `call-${inferenceCalls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
      if (inferenceCalls === 1) return call('codemode', { code: 'const f = await tools.read_file({path:"README.md"}); await tools.write_file({path:f.path, content:"Agent changed 🌴\\n", expectedRevision:f.revision}); text(await tools.git_diff({}));' });
      if (inferenceCalls === 2) return call('git_commit', { message: 'Update README', expectedRevision: 2, expectedHead: initial.head });
      return { choices: [{ finish_reason: 'stop', message: { content: 'Updated README and committed scratch changes.' } }] };
    }
    return null;
  });
  await page.addInitScript(({ pageChannel, replyChannel, hostedRelayRevision }) => {
    window.addEventListener('message', async event => {
      const message = event.data;
      if (event.source !== window || message?.channel !== pageChannel) return;
      try { const result = await (window as any).agentTestBridge(message.request); window.postMessage({ channel: replyChannel, version: 1, relayRevision: hostedRelayRevision, requestId: message.requestId, ok: true, result }, location.origin); }
      catch (error) { window.postMessage({ channel: replyChannel, version: 1, relayRevision: hostedRelayRevision, requestId: message.requestId, ok: false, error: String(error) }, location.origin); }
    });
  }, { pageChannel, replyChannel, hostedRelayRevision });
  return { objects, calls: () => inferenceCalls };
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Load connections', exact: true }).click();
  await expect(page.getByLabel('Inference connection', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Inference connection', { exact: true }).selectOption({ label: 'Test inference' });
  await page.getByLabel('GitHub connection', { exact: true }).selectOption({ label: 'Test GitHub' });
  await page.getByLabel('S3 session storage').selectOption({ label: 'Test S3' });
}
test('hosted agent imports pinned files, executes real QuickJS tool loop, commits and restores messages plus scratch from S3', async ({ page }) => {
  test.setTimeout(180000); const remote = await mockBridge(page);
  await page.goto(`${origin}#/agent`); await connect(page);
  await page.getByLabel('Source repository').fill('owner/repo'); await page.getByLabel('Source commit SHA').fill('a'.repeat(40)); await page.getByLabel('Source directory (empty for root)').fill('docs');
  await page.getByRole('button', { name: 'Import pinned directory' }).click();
  await expect(page.getByText(/Saved and readback-verified:/)).toBeVisible();
  const session = await page.getByLabel('Session UUID').inputValue();
  await page.getByLabel('Message to agent').fill('Update README and commit'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.agent-transcript')).toContainText('Updated README and committed', { timeout: 30000 });
  await expect.poll(() => remote.objects.size).toBe(2);
  const checkpoint = [...remote.objects.keys()].sort().at(-1)!;
  const saved = JSON.parse(remote.objects.get(checkpoint)!);
  expect(saved.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ error: m.isError, content: m.isError ? m.content : undefined }))).toEqual([{ error: false }, { error: false }]);
  expect(saved.scratch.files[0].content).toBe('Agent changed 🌴\n'); expect(saved.scratch.commits).toHaveLength(2); expect(remote.calls()).toBe(3);
  await page.reload(); await connect(page); await page.getByLabel('Session UUID').fill(session); await page.getByRole('button', { name: 'List checkpoints', exact: true }).click();
  await page.getByLabel('Saved checkpoint').selectOption(checkpoint); await page.getByRole('button', { name: 'Restore session & scratch', exact: true }).click();
  await expect(page.locator('.agent-transcript')).toContainText('Updated README and committed'); await expect(page.getByText(saved.scratch.commits.at(-1).oid, { exact: true }).first()).toBeVisible(); expect(remote.calls()).toBe(3);
  await page.getByLabel('Scratch JavaScript', { exact: true }).fill('await tools.write_file({path:"bad.txt", content:"discard", expectedRevision:3}); throw Error("discard this execution");');
  await page.getByRole('button', { name: 'Run scratch JavaScript', exact: true }).click();
  await expect(page.locator('.agent-scratch')).toContainText('discard this execution'); expect(remote.objects.size).toBe(2);
  await expect(page.getByRole('list', { name: 'Scratch files' })).not.toContainText('bad.txt');
  await page.getByLabel('Scratch JavaScript', { exact: true }).fill('text({fetch: typeof fetch, process: typeof process, file: await tools.read_file({path:"README.md"})});');
  await page.getByRole('button', { name: 'Run scratch JavaScript', exact: true }).click();
  await expect(page.locator('.agent-scratch')).toContainText('undefined'); await expect.poll(() => remote.objects.size).toBe(3);
});
test('worker bounds infinite scripts without blocking the hosted UI', async ({ page }) => {
  test.setTimeout(120000); await mockBridge(page); await page.goto(`${origin}#/agent`); await connect(page); await page.getByRole('button', { name: 'New empty workspace' }).click(); await expect(page.getByText(/Saved and readback-verified:/)).toBeVisible();
  await page.getByLabel('Scratch JavaScript', { exact: true }).fill('while (true) {}'); await page.getByRole('button', { name: 'Run scratch JavaScript', exact: true }).click();
  await expect(page.locator('.agent-scratch')).toContainText('timeout', { timeout: 25000 }); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled(); await expect(page.getByLabel('Message to agent')).toBeEnabled();
});
test('production Agent preserves drafts and source selection across all six device orientations', async ({ page }) => {
  test.setTimeout(120000); await mockBridge(page); await page.goto(`${origin}#/agent`);
  await page.getByLabel('Message to agent').fill('Preserve this draft'); await page.getByLabel('Source repository').fill('owner/repo');
  for (const [surface, orientation, width, height] of [
    ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
    ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
    ['desktop', 'portrait', 1000, 1600], ['desktop', 'landscape', 1600, 1000],
  ] as const) {
    await page.getByRole('heading', { name: 'Workspace agent', exact: true }).click(); await page.setViewportSize({ width, height });
    await expect(page.locator(`main.agent-page[data-surface="${surface}"][data-orientation="${orientation}"]`)).toBeVisible();
    await expect(page.getByLabel('Message to agent')).toHaveValue('Preserve this draft'); await expect(page.getByLabel('Source repository')).toHaveValue('owner/repo');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

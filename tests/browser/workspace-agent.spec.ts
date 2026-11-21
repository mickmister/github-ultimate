import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { createServer as createHttpServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pageChannel, replyChannel, hostedRelayRevision } from '../../src/bridge-channels';
import { Scratch, gitObject, gitTreeEntries, type ScratchEntry } from '../../src/scratch';
import { createHash } from 'node:crypto';

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
  const blob = gitObject('blob', 'Pinned original\n'), nested = gitTreeEntries([{ name: 'untouched.txt', mode: '100644', oid: 'f'.repeat(40) }]);
  const entries: ScratchEntry[] = [{ name: 'README.md', type: 'blob', mode: '100644', oid: blob, size: 16 }, { name: 'nested', type: 'tree', mode: '40000', oid: nested, size: 0 }], tree = gitTreeEntries(entries);
  const initial = new Scratch({ version: 1, revision: 0, origin: { repository: 'owner/repo', commit: 'a'.repeat(40), directory: 'docs' }, base: { tree, trees: { [tree]: entries } }, files: [], commits: [] });
  let blobReads = 0;
  initial.commit('Pinned import', 0, null, 0);
  await page.exposeFunction('agentTestBridge', async (request: any) => {
    if (request.operation === 's3Capabilities') return { capabilities: ['s3AllowMissing'] };
    if (request.operation === 'discover') return { capabilities: ['agentGraphql', 'agentTree', 'agentBlob', 's3Checkpoint', 's3AllowMissing'] };
    if (request.operation === 'inferenceConnections') return [{ id: 'inference', revision, name: 'Test inference', model: 'test-model', hostedGrants: [] }];
    if (request.operation === 'connections') return [{ id: 'github', name: 'Test GitHub', appId: 1, user: { id: 2, login: 'tester' }, installation: { id: 3, account: 'tester' } }];
    if (request.operation === 's3Connections') return [{ id: 'storage', revision, name: 'Test S3', endpoint: 'https://s3.example/', bucket: 'sessions', prefix: 'private/', region: 'auto', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false }];
    if (request.operation === 'agentSnapshot') { expect(request).toMatchObject({ repository: 'owner/repo', commit: 'a'.repeat(40), directory: 'docs' }); return initial.snapshot(); }
    if (request.operation === 'agentBlob') { expect(request.oid).toBe(blob); blobReads++; return { sha: blob, encoding: 'base64', size: 16, content: Buffer.from('Pinned original\n').toString('base64') }; }
    if (request.operation === 'agentTree') throw Error('Unrelated directory must remain lazy.');
    if (request.operation === 's3Checkpoint') { const body = Buffer.from(request.base64, 'base64'), sha256 = createHash('sha256').update(body).digest('hex'), key = `private/pi-sessions/${request.sessionId}/${new Date().toISOString()}-${crypto.randomUUID()}-${sha256}.json`; objects.set(key, body.toString('utf8')); return { key, sha256 }; }
    if (request.operation === 's3Read') { const body = objects.get(request.key); if (body === undefined && request.allowMissing) return { key: request.key, missing: true }; if (body === undefined) throw Error('Missing object'); return { key: request.key, size: Buffer.byteLength(body), base64: Buffer.from(body).toString('base64') }; }
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
  return { objects, calls: () => inferenceCalls, blobReads: () => blobReads };
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
  expect(remote.blobReads()).toBe(0);
  const session = await page.getByLabel('Session UUID').inputValue();
  await page.getByLabel('Message to agent').fill('Update README and commit'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.agent-transcript')).toContainText('Updated README and committed', { timeout: 30000 });
  await expect.poll(() => remote.objects.size).toBe(2);
  const checkpoint = [...remote.objects.keys()].sort().at(-1)!;
  const saved = JSON.parse(remote.objects.get(checkpoint)!);
  expect(saved.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ error: m.isError, content: m.isError ? m.content : undefined }))).toEqual([{ error: false }, { error: false }]);
  expect(saved.scratch.files[0].content).toBe('Agent changed 🌴\n'); expect(saved.scratch.commits).toHaveLength(2); expect(remote.calls()).toBe(3);
  expect(remote.blobReads()).toBe(1); expect(Object.keys(saved.scratch.base.trees)).toHaveLength(1);
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
  await page.getByRole('button', { name: 'Load diff', exact: true }).click();
  await expect(page.locator('.agent-scratch')).toContainText('"complete": true');
  expect(remote.objects.size).toBe(3); expect(remote.blobReads()).toBe(1);
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
test('remote Actions session streams before settlement, keeps six-surface continuity and reopens without replaying tools', async ({ page }) => {
  test.setTimeout(120000);
  const remote = await mockBridge(page), root = 'private/qrspi-hosted/';
  const binding = { workspace: 'demo', workspace_ref: 'ws-' + '1'.repeat(32), process: 'pilot', bead: 'task-test' };
  const evidencePrefix = root + 'processes/' + 'a'.repeat(64) + '/executions/123-1/work/', key = root + 'live/owner/storage/demo/123-1/work.json';
  const put = (key: string, value: unknown) => remote.objects.set(key, JSON.stringify(value));
  put(key, { kind: 'pi-live-locator', schemaVersion: 1, binding, storageRepository: 'owner/storage', repository: 'owner/engine', executionId: '123-1', command: 'work', sourceSha: 'b'.repeat(40), piVersion: '1.5.2', createdAt: '2026-11-21T12:00:00.000Z', evidencePrefix });
  const row = (sequence: number, event: unknown) => ({ schemaVersion: 1, sequence, timestamp: new Date().toISOString(), kind: 'pi', sessionId: 'parent', parentId: null, role: 'orchestrator', data: { source: 'phase-events.log', event } });
  const chunk = (events: unknown[]) => ({ schemaVersion: 1, binding, executionId: '123-1', phaseApproval: false, replayAuthorized: false, events });
  const open = async () => {
    await page.getByRole('button', { name: 'Load Actions storage', exact: true }).click();
    await page.getByLabel('Actions S3 connection').selectOption({ label: 'Test S3' });
    await page.getByLabel('Actions storage root').fill(root);
    await page.getByRole('button', { name: 'Find remote sessions', exact: true }).click();
    await page.getByLabel('Remote session', { exact: true }).selectOption(key);
    await page.getByRole('button', { name: 'Follow session', exact: true }).click();
  };
  await page.goto(`${origin}#/agent?repository=owner%2Fstorage&workspace=demo`);
  await page.getByLabel('Message to agent').fill('Preserve my local draft');
  await open();
  await expect(page.getByText('Following · read-only', { exact: true })).toBeVisible();
  put(evidencePrefix + 'chunks/000001.json', chunk([
    row(1, { type: 'message_start', message: { role: 'assistant', content: [] } }),
    row(2, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Live from Actions 🌍' } }),
    row(3, { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'workspace_operation' }),
  ]));
  await expect(page.locator('.agent-remote-transcript')).toContainText('Live from Actions 🌍', { timeout: 12000 });
  await expect(page.getByRole('region', { name: 'Remote tool activity' })).toContainText('running');
  for (const [surface, orientation, width, height] of [
    ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390], ['tablet', 'portrait', 820, 1180],
    ['tablet', 'landscape', 1180, 820], ['desktop', 'portrait', 1000, 1600], ['desktop', 'landscape', 1600, 1000],
  ] as const) {
    await page.getByRole('heading', { name: 'Workspace agent', exact: true }).click(); await page.setViewportSize({ width, height });
    await expect(page.locator(`main.agent-page[data-surface="${surface}"][data-orientation="${orientation}"]`)).toBeVisible();
    await expect(page.locator('.agent-remote-transcript article')).toHaveCount(1);
    await expect(page.getByLabel('Message to agent')).toHaveValue('Preserve my local draft');
    await expect(page.getByLabel('Remote session', { exact: true })).toHaveValue(key);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Pause viewing', exact: true }).click();
  put(evidencePrefix + 'chunks/000002.json', chunk([
    row(4, { type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'workspace_operation', isError: false, result: { content: [{ type: 'text', text: 'Read complete' }] } }),
    row(5, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Actions result, finalized.' }] } }),
  ]));
  put(evidencePrefix + 'terminal.json', { kind: 'pi-live-terminal', schemaVersion: 1, binding, executionId: '123-1', command: 'work', status: 'completed', chunks: 2, sequence: 5, finishedAt: new Date().toISOString(), phaseApproval: false });
  await page.getByRole('button', { name: 'Follow session', exact: true }).click();
  await expect(page.getByText('Invocation completed · read-only', { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.locator('.agent-remote-transcript article')).toHaveCount(1);
  await expect(page.locator('.agent-remote-transcript')).toContainText('Actions result, finalized.');
  const href = await page.getByRole('link', { name: 'Session link', exact: true }).getAttribute('href');
  expect(href).toContain('live=');
  await page.goto(`${origin}${href}`); await page.reload(); await open();
  await expect(page.getByText('Invocation completed · read-only', { exact: true })).toBeVisible();
  await expect(page.locator('.agent-remote-transcript article')).toHaveCount(1); expect(remote.calls()).toBe(0);
});

import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { nativeFixture, remoteFixture } from './native-fixture';
import { previewFixture } from './preview-fixture';
import { previewDirectory } from '../../src/preview-directory';
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

test('SDK-shaped streamed tool calls render, execute, persist and restore', async ({ page }) => {
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const remote = remoteFixture(() => paused, 'text("Tool result café")'), fixture = await nativeFixture(page, `${origin}${base}`, remote), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(fixture.url); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Run a tool'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: /^codemode/ })).toBeVisible(); release();
    await expect(page.getByRole('status')).toHaveText('Saved to S3');
    const saved = [...remote.objects.values()].map(object => JSON.parse(object.text)).reverse().find(checkpoint => checkpoint.phase === 'idle');
    expect(saved.messages.find((message: { role: string }) => message.role === 'assistant').content[0]).toMatchObject({ type: 'toolCall', id: 'call-render', name: 'codemode', arguments: { code: 'text("Tool result café")' } });
    expect(saved.messages.some((message: { role: string; toolCallId?: string }) => message.role === 'toolResult' && message.toolCallId === 'call-render')).toBe(true);
    await page.getByRole('button', { name: /^codemode/ }).click(); await expect(page.getByRole('log')).toContainText('Tool result café');
    await expect(page.getByRole('log')).toContainText('Real Pi reply 2');
    await page.reload(); await expect(page.getByRole('button', { name: /^codemode/ })).toBeVisible();
    await expect(page.getByRole('log')).toContainText('Tool result café'); await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); expect(remote.requests).toHaveLength(2); expect(errors).toEqual([]);
  } finally { release(); fixture.dispose(); }
});

test('published JavaScript links to usable first-party source maps', async ({ page }) => {
  await page.goto(`${origin}${base}`);
  const urls = await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => (script as HTMLScriptElement).src));
  let checked = false;
  for (const url of urls) {
    const script = await (await page.request.get(url)).text();
    if (!script.includes('Retry display')) continue;
    const link = /sourceMappingURL=([^\s]+)/.exec(script)?.[1]; expect(link).toBeTruthy();
    const response = await page.request.get(new URL(link!, url).href); expect(response.ok()).toBe(true);
    const map = await response.json(); expect(map.version).toBe(3); expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sources.some((source: string) => source.includes('ErrorBoundary.view.tsx'))).toBe(true);
    expect(map.sourcesContent.some((source: string | null) => source?.includes('componentDidCatch'))).toBe(true); checked = true;
  }
  expect(checked).toBe(true);
  const runtime = await (await page.request.get(`${origin}${base}extension-runtime.js`)).text();
  const link = /sourceMappingURL=([^\s]+)/.exec(runtime)?.[1]; expect(link).toBeTruthy();
  const response = await page.request.get(new URL(link!, `${origin}${base}extension-runtime.js`).href); expect(response.ok()).toBe(true);
  expect((await response.json()).sources.some((source: string) => source.includes('pi-chat.ts'))).toBe(true);
});

for (const action of ['stop', 'reload'] as const) test(`${action} during a tool preserves its intent without automatic replay`, async ({ page }) => {
  let release!: () => void, entered = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const source = `${origin}${base}`, previews = previewFixture(source), original = previews.host.hosted.bind(previews.host);
  previews.host.hosted = async (...args) => {
    const input = args[1];
    if (input && typeof input === 'object' && 'operation' in input && input.operation === 'workflowCatalog') { entered = true; await pending; }
    return original(...args);
  };
  const remote = remoteFixture(undefined, 'text(await tools.workflows_list({}))'), fixture = await nativeFixture(page, source, remote, previews.host);
  try {
    await page.goto(fixture.url); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect workspace'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: /^codemode/ })).toBeVisible();
    await expect.poll(() => entered, { timeout: 15_000, message: 'QuickJS must reach the held workspace discovery operation' }).toBe(true);
    if (action === 'stop') await page.getByRole('button', { name: 'Stop', exact: true }).click();
    else await page.reload();
    await expect(page.getByRole('button', { name: 'Continue interrupted turn', exact: true })).toBeEnabled();
    expect(remote.requests).toHaveLength(1);
    const checkpoints = [...remote.objects.values()].map(object => JSON.parse(object.text));
    expect(checkpoints.some(checkpoint => checkpoint.phase === 'pending' && checkpoint.messages?.at(-1)?.content?.some?.((block: { type: string }) => block.type === 'toolCall'))).toBe(true);
    release();
    await page.reload(); await expect(page.getByRole('button', { name: 'Continue interrupted turn', exact: true })).toBeEnabled();
    expect(remote.requests).toHaveLength(1);
  } finally { release(); fixture.dispose(); }
});

for (const width of [390, 1440]) {
test(`${width}px: Alohak workspace tabs, discreet sidebar and modal settings retain the draft`, async ({ page }) => {
  const fixture = await nativeFixture(page, `${origin}${base}`, remoteFixture());
  try {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixture.url);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(1); await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
    const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('Keep draft through settings');
    await expect(page.getByRole('combobox', { name: 'Inference connection' })).not.toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true }); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Inference connection' })).toBeVisible();
    await page.setViewportSize({ width: 900, height: width }); await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await expect(input).toHaveValue('Keep draft through settings');
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.setViewportSize({ width, height: 900 });
    if (width < 600) await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    const sidebar = page.getByRole('navigation', { name: 'Saved conversations', exact: true });
    await expect(sidebar.locator('.chat-sidebar-workspace')).toContainText('selected-workspace');
    await expect(sidebar.getByRole('combobox')).toHaveCount(0);
    for (const name of ['Refresh conversations', 'New conversation', 'Change workspace', 'Settings']) {
      await expect(sidebar.getByRole('button', { name, exact: true })).toHaveText('');
    }
    await expect(sidebar.getByRole('searchbox', { name: 'Search conversations' })).toHaveAttribute('placeholder', 'Search…');
    const home = new URL('../app/', fixture.url).href;
    await page.route(home, route => route.fulfill({ contentType: 'text/html', body: '<h1>Workspace home</h1>' }));
    await sidebar.getByRole('button', { name: 'Alohak', exact: true }).click(); await expect(page).toHaveURL(home);
  } finally { fixture.dispose(); }
});
test(`${width}px: workspace URL is authoritative for chooser, history, shared links and mismatched conversations`, async ({ page }) => {
  const source = `${origin}${base}`, remote = remoteFixture(), fixture = await nativeFixture(page, source, remote);
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(source); await expect(page.getByRole('heading', { name: 'Choose workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('log')).toHaveCount(0); await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Choose workspace', exact: true }).selectOption(JSON.stringify(['owner/storage', 'selected-workspace']));
    await expect(page).toHaveURL(/workspace=selected-workspace/);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Only in selected workspace'); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved to S3'); const saved = page.url();
    await page.getByRole('button', { name: 'Change workspace', exact: true }).click();
    await page.getByRole('combobox', { name: 'Choose workspace', exact: true }).selectOption(JSON.stringify(['owner/storage', 'other-workspace']));
    await expect(page).toHaveURL(/workspace=other-workspace/); await expect(page.getByRole('log')).not.toContainText('Only in selected workspace');
    await page.getByLabel('Preview slots', { exact: true }).click();
    await expect(page.getByRole('link', { name: /Storybook/ })).toHaveAttribute('href', /workspace=other-workspace/);
    await page.goBack(); await expect(page.getByRole('heading', { name: 'Choose workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Choose workspace', exact: true })).toBeEnabled();
    await page.goBack(); await expect(page.getByRole('log')).toContainText('Only in selected workspace');
    await page.goForward(); await expect(page.getByRole('heading', { name: 'Choose workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Choose workspace', exact: true })).toBeEnabled();
    await page.goForward(); await expect(page).toHaveURL(/workspace=other-workspace/); await expect(page.getByRole('log')).not.toContainText('Only in selected workspace');
    const wrong = new URL(saved); wrong.searchParams.set('workspace', 'other-workspace'); wrong.searchParams.set('connection', crypto.randomUUID());
    await page.goto(wrong.href); await expect(page.getByRole('alert').filter({ hasText: 'belongs to workspace selected-workspace' })).toBeVisible();
    await expect(page.getByRole('log')).not.toContainText('Only in selected workspace'); expect(new URL(page.url()).searchParams.get('workspace')).toBe('other-workspace');
    await page.getByRole('button', { name: 'Open conversation in selected-workspace', exact: true }).click();
    await expect(page).toHaveURL(/workspace=selected-workspace/); await expect(page.getByRole('log')).toContainText('Only in selected workspace');
    const oldLink = new URL(saved); oldLink.searchParams.delete('workspace'); oldLink.searchParams.delete('repository');
    await page.goto(oldLink.href); await expect(page.getByRole('log')).toContainText('Only in selected workspace'); await expect(page).toHaveURL(/workspace=selected-workspace/);
    expect(remote.requests).toHaveLength(1);
  } finally { fixture.dispose(); }
});
}

test('another device moving a conversation cannot silently switch the current URL scope', async ({ browser }) => {
  const context = await browser.newContext(), remote = remoteFixture();
  try {
    const left = await context.newPage(), right = await context.newPage(), source = `${origin}${base}`;
    const a = await nativeFixture(left, source, remote), b = await nativeFixture(right, source, remote);
    try {
      await left.goto(a.url); await left.getByRole('button', { name: 'New conversation', exact: true }).click();
      await left.getByRole('textbox', { name: 'Message', exact: true }).fill('Moved on another device'); await left.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(left.getByRole('status')).toHaveText('Saved to S3'); await right.goto(left.url());
      await expect(right.getByRole('log')).toContainText('Moved on another device'); await right.getByRole('button', { name: 'Settings', exact: true }).click();
      await right.getByRole('combobox', { name: 'Move conversation to workspace', exact: true }).selectOption(JSON.stringify(['owner/storage', 'other-workspace']));
      await expect(right).toHaveURL(/workspace=other-workspace/); await expect(right.getByRole('status')).toHaveText('Saved to S3');
      await left.getByRole('textbox', { name: 'Message', exact: true }).fill('Retain my unsent draft');
      await left.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
      await expect(left.getByRole('alert').filter({ hasText: 'belongs to workspace other-workspace' })).toBeVisible();
      expect(new URL(left.url()).searchParams.get('workspace')).toBe('selected-workspace');
      await expect(left.getByRole('log')).not.toContainText('Moved on another device');
      await expect(left.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Retain my unsent draft');
      await left.getByRole('button', { name: 'Open conversation in other-workspace', exact: true }).click();
      await expect(left).toHaveURL(/workspace=other-workspace/); await expect(left.getByRole('log')).toContainText('Moved on another device');
      expect(remote.requests).toHaveLength(1);
    } finally { a.dispose(); b.dispose(); }
  } finally { await context.close(); }
});

for (const [name, width, height] of [['phone portrait',390,844],['phone landscape',844,390],['tablet portrait',820,1180],['tablet landscape',1180,820],['desktop portrait',1080,1440],['desktop landscape',1440,900]] as const) {
  test(`${name}: real S3 chat survives rotation and reload through the native wire protocol`, async ({ page }) => {
    const remote = remoteFixture(), fixture = await nativeFixture(page, `${origin}${base}`, remote), errors: string[] = [], api: string[] = [];
    page.on('pageerror', error => { if (error.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(error.message); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
    await page.setViewportSize({ width, height }); await page.goto(fixture.url);
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
for (const width of [390, 1440]) {
  test(`${width}px: workspace browsing, durable creation and moves preserve pinned history and drafts`, async ({ page }) => {
    const remote = remoteFixture(), source = `${origin}${base}`, previews = previewFixture(source), fixture = await nativeFixture(page, source, remote, previews.host);
    try {
      await page.setViewportSize({ width, height: 900 });
      const url = new URL(source); url.searchParams.set('connection', previews.navigation.connectionId); url.searchParams.set('repository', previews.navigation.repository); url.searchParams.set('workspace', previews.workspace);
      await page.goto(url.href); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      expect(remote.objects.size).toBe(0);
      const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('Scoped conversation'); await input.press('Enter');
      await expect(page.getByRole('status')).toHaveText('Saved to S3'); await expect(page.getByRole('log')).toContainText('Real Pi reply 1');
      const pinned = new URL(page.url()); pinned.searchParams.set('view', 'checkpoint');
      await page.reload(); await expect(page.getByRole('log')).toContainText('Scoped conversation'); expect(remote.requests).toHaveLength(1);
      if (width < 600) await page.getByRole('button', { name: 'Conversations', exact: true }).click();
      const key = JSON.stringify([previews.navigation.repository, previews.workspace]);
      await expect(page.locator('.chat-sidebar-workspace')).toContainText(previews.workspace);
      await expect(page.getByRole('button', { name: /Scoped conversation.*messages/ })).toHaveCount(1);
      await fixture.seedLegacy('Unassigned conversation');
      await page.getByRole('button', { name: 'Change workspace', exact: true }).click();
      await page.getByRole('button', { name: 'Unassigned migration inbox', exact: true }).click(); await expect(page.getByRole('button', { name: /Scoped conversation.*messages/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
      await page.getByRole('button', { name: /Unassigned conversation.*messages/ }).click();
      await expect(page.getByRole('status')).toHaveText('Saved to S3');
      await expect(input).toBeDisabled(); await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('combobox', { name: 'Move conversation to workspace', exact: true }).selectOption(key);
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Saved to S3');
      if (width < 600) await page.getByRole('button', { name: 'Conversations', exact: true }).click();
      await expect(page.locator('.chat-sidebar-workspace')).toContainText(previews.workspace); await expect(page.getByRole('button', { name: /conversation.*messages/ })).toHaveCount(2);
      if (width < 600) await page.getByRole('button', { name: 'Hide conversations', exact: true }).click();
      await input.fill('Keep this unsent draft when changing workspace');
      if (width < 600) await page.getByRole('button', { name: 'Conversations', exact: true }).click();
      await page.getByRole('button', { name: 'Change workspace', exact: true }).click();
      await page.getByRole('button', { name: 'Unassigned migration inbox', exact: true }).click(); await expect(page.getByRole('button', { name: /conversation.*messages/ })).toHaveCount(0);
      if (width < 600) await page.getByRole('button', { name: 'Hide conversations', exact: true }).click();
      await expect(input).toHaveValue('Keep this unsent draft when changing workspace');
      await page.goto(pinned.href); await expect(page.getByRole('log')).toContainText('Scoped conversation'); await expect(page.getByRole('log')).not.toContainText('Unassigned conversation');
      expect(remote.requests).toHaveLength(2);
    } finally { fixture.dispose(); }
  });
}
test('independent device connections restore the same S3 conversation and preserve divergent continuations', async ({ browser }) => {
  const remote = remoteFixture(), first = await browser.newContext(), second = await browser.newContext();
  try {
    const left = await first.newPage(), right = await second.newPage();
    const a = await nativeFixture(left, `${origin}${base}`, remote), b = await nativeFixture(right, `${origin}${base}`, remote);
    expect(a.storage.id).not.toBe(b.storage.id); expect(a.inference.id).not.toBe(b.inference.id);
    await left.goto(a.url); await expect(left.getByRole('button', { name: 'New conversation' })).toBeEnabled(); await left.getByRole('button', { name: 'New conversation' }).click();
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
    const pinned = new URL(right.url()); pinned.searchParams.set('view', 'checkpoint');
    await left.goto(pinned.href); await expect(left.getByRole('log')).toContainText('Continue on phone'); await expect(left.getByRole('log')).toContainText('Real Pi reply 2');
    a.dispose(); b.dispose();
  } finally { await first.close(); await second.close(); }
});
test('new is only a draft and the upstream-adapted sidebar shows one row per conversation', async ({ page }) => {
  const remote = remoteFixture(), fixture = await nativeFixture(page, `${origin}${base}`, remote);
  try {
    await page.goto(fixture.url);
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
    const firstTurnObjects = remote.objects.size;
    await input.fill('Second turn'); await input.press('Enter'); await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect(library.locator('li')).toHaveCount(1); expect(remote.objects.size).toBeGreaterThan(firstTurnObjects);
    const savedObjects = remote.objects.size;
    await create.click(); await expect(library.locator('li')).toHaveCount(1); expect(remote.objects.size).toBe(savedObjects);
    await library.getByRole('button', { name: /Canonical first conversation/ }).click();
    await expect(page.getByRole('log')).toContainText('Second turn'); await expect(page.getByRole('log')).toContainText('Real Pi reply 2'); expect(remote.requests).toHaveLength(2);
    await create.click(); await input.fill('Canonical second conversation'); await input.press('Enter'); await expect(page.getByRole('status')).toHaveText('Saved to S3');
    await expect(library.locator('li')).toHaveCount(2);
    await library.getByRole('searchbox', { name: 'Search conversations' }).fill('first'); await expect(library.locator('li')).toHaveCount(1);
  } finally { fixture.dispose(); }
});
test('two tabs reload and refresh the latest conversation while explicit checkpoint links stay pinned', async ({ browser }) => {
  const context = await browser.newContext(), remote = remoteFixture();
  try {
    const left = await context.newPage(), right = await context.newPage();
    const a = await nativeFixture(left, `${origin}${base}`, remote), b = await nativeFixture(right, `${origin}${base}`, remote);
    await left.goto(a.url); await left.getByRole('button', { name: 'New conversation', exact: true }).click();
    await left.getByRole('textbox', { name: 'Message', exact: true }).fill('Shared conversation'); await left.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(left.getByRole('status')).toHaveText('Saved to S3');
    await left.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { Object.assign(window, { copiedChatLink: text }); } } }); });
    await left.getByRole('button', { name: 'Copy conversation link', exact: true }).click();
    const original = new URL(await left.evaluate(() => (window as unknown as { copiedChatLink: string }).copiedChatLink));
    expect(original.searchParams.get('view')).toBe('checkpoint'); expect(new URL(left.url()).searchParams.has('view')).toBe(false);
    await right.goto(left.url()); await expect(right.getByRole('log')).toContainText('Real Pi reply 1');
    await right.getByRole('textbox', { name: 'Message', exact: true }).fill('Added in the other tab'); await right.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(right.getByRole('status')).toHaveText('Saved to S3');
    const secondTurnObjects = remote.objects.size;
    await left.reload(); await expect(left.getByRole('log')).toContainText('Added in the other tab'); await expect(left.getByRole('log')).toContainText('Real Pi reply 2');
    expect(remote.requests).toHaveLength(2); expect(remote.objects.size).toBe(secondTurnObjects);
    const draft = left.getByRole('textbox', { name: 'Message', exact: true }); await draft.fill('Keep my unsent draft');
    await right.getByRole('textbox', { name: 'Message', exact: true }).fill('Third turn in other tab'); await right.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(right.getByRole('status')).toHaveText('Saved to S3');
    const thirdTurnObjects = remote.objects.size;
    await left.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
    await expect(left.getByRole('log')).toContainText('Real Pi reply 3'); await expect(draft).toHaveValue('Keep my unsent draft');
    await left.goto(original.href); await expect(left.getByRole('log')).toContainText('Real Pi reply 1');
    await expect(left.getByRole('log')).not.toContainText('Added in the other tab');
    await left.reload(); await expect(left.getByRole('log')).toContainText('Real Pi reply 1'); await expect(left.getByRole('log')).not.toContainText('Real Pi reply 3');
    await left.getByRole('navigation', { name: 'Saved conversations' }).getByRole('button', { name: /Shared conversation/ }).click();
    await expect(left.getByRole('log')).toContainText('Real Pi reply 3'); expect(new URL(left.url()).searchParams.has('view')).toBe(false);
    expect(remote.requests).toHaveLength(3); expect(remote.objects.size).toBe(thirdTurnObjects);
    a.dispose(); b.dispose();
  } finally { await context.close(); }
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
    await page.goto(fixture.url); await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeEnabled();
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
    await page.goto(fixture.url); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
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
for (const [name, width, height] of [['phone portrait',390,844],['phone landscape',844,390],['tablet portrait',820,1180],['tablet landscape',1180,820],['desktop portrait',1080,1440],['desktop landscape',1440,900]] as const) {
  test(`${name}: workspace preview slots read nugs config and open a canonical URL without losing the composer`, async ({ page }) => {
    const remote = remoteFixture(), source = `${origin}${base}`, previews = previewFixture(source), fixture = await nativeFixture(page, source, remote, previews.host);
    try {
      await page.setViewportSize({ width, height });
      const url = new URL(source); url.searchParams.set('connection', previews.navigation.connectionId); url.searchParams.set('repository', previews.navigation.repository); url.searchParams.set('workspace', previews.workspace);
      await page.goto(url.href); await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      const draft = page.getByRole('textbox', { name: 'Message', exact: true }); await draft.fill('Keep this draft while opening Storybook');
      expect(new URL(page.url()).searchParams.get('workspace')).toBe(previews.workspace);
      await page.getByLabel('Preview slots', { exact: true }).click();
      const link = page.getByRole('link', { name: /Storybook/ });
      const expected = `https://preview.example/owner-repo/storybook/${previewDirectory(previews.branch)}/?workspace=${previews.workspace}`;
      await expect(link).toHaveAttribute('href', expected); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await page.context().route('https://preview.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Preview fixture</h1>' }));
      const opened = page.waitForEvent('popup'); await link.click(); const popup = await opened;
      await expect(popup).toHaveURL(expected); expect(await popup.evaluate(() => window.opener === null)).toBe(true); await popup.close();
      await expect(draft).toHaveValue('Keep this draft while opening Storybook');
      await page.setViewportSize({ width: height, height: width });
      await expect(page.getByRole('link', { name: /Storybook/ })).toBeVisible(); await expect(draft).toHaveValue('Keep this draft while opening Storybook');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      previews.update(); await page.getByRole('button', { name: 'Refresh previews', exact: true }).click();
      await expect(page.getByRole('link', { name: /Updated Storybook/ })).toHaveAttribute('href', expected);
      expect(previews.calls.some(path => path.includes('/git/blobs/'))).toBe(true);
      expect(await page.content()).not.toContain('private-github-secret'); expect(remote.requests).toHaveLength(0); expect(remote.objects.size).toBe(0);
    } finally { fixture.dispose(); }
  });
}

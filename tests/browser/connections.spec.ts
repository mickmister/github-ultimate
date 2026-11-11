import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let context: BrowserContext, profile: string;
async function fillApp(page: Page, name = 'GitHub Ultimate client') {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('App ID', { exact: true }).fill('12345');
  await page.getByLabel('Public Client ID').fill('Iv23ExampleClient');
}
async function launch(hosted = false) {
  let extension = resolve('dist');
  if (hosted) {
    extension = resolve(profile, 'extension');
    await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    // Test-only pre-granted browser host access avoids an unattended browser
    // permission dialog. The real per-connection grant is still made through UI.
    manifest.host_permissions.push('https://mickmister.github.io/*');
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  }
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await mockGitHub(worker);
  return worker.url().split('/')[2];
}
async function mockGitHub(worker: Worker) {
  await worker.evaluate(() => {
    let serial = 0;
    const network = globalThis as typeof globalThis & { __githubRequests: string[] };
    network.__githubRequests = [];
    const document = '<script>window.__unsafeDocument = true</script>\nPrivate workspace note';
    const manifest = `5:__DOLT__:${'0'.repeat(32)}:${'1'.repeat(32)}:${'0'.repeat(32)}`;
    const workspaceManifest = JSON.stringify({ schema_version: 1, workspace: 'workspace-a', observed_at: '2026-11-09T00:00:00Z', purpose: 'Explore product requirements before choosing source repositories' });
    const blob = async (content: string) => {
      const bytes = new TextEncoder().encode(content);
      const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
      const object = new Uint8Array(header.length + bytes.length); object.set(header); object.set(bytes, header.length);
      const hash = await crypto.subtle.digest('SHA-1', object);
      return { sha: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''), size: bytes.length, encoding: 'base64', content: btoa(content) };
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      network.__githubRequests.push(url);
      if (url === 'https://github.com/login/device/code') return Response.json({ device_code: 'private-device-secret', user_code: 'BROW-SER1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (url === 'https://github.com/login/oauth/access_token') {
        serial++;
        return Response.json({ access_token: `ghu_browser_secret_${serial}`, refresh_token: `ghr_browser_secret_${serial}`, token_type: 'bearer', expires_in: 28800, refresh_token_expires_in: 15897600 });
      }
      if (!(init.headers as Record<string, string>)?.Authorization?.startsWith('Bearer ghu_browser_secret_')) return Response.json({}, { status: 401 });
      if (url === 'https://api.github.com/user') return Response.json({ login: 'mickmister', id: 1 });
      if (url.startsWith('https://api.github.com/user/installations?')) return Response.json({ installations: [{ id: 123, app_id: 12345, account: { login: 'mickmister' }, permissions: { contents: 'read', metadata: 'read', actions: 'write' } }] });
      if (url.startsWith('https://api.github.com/user/installations/123/repositories?')) return Response.json({ repositories: [{ full_name: 'mickmister/workspace-storage', private: true, default_branch: 'main' }] });
      if (url === 'https://api.github.com/repos/mickmister/workspace-storage/git/ref/heads/main') return Response.json({ object: { sha: 'b'.repeat(40), type: 'commit' } });
      const git = 'https://api.github.com/repos/mickmister/workspace-storage/git/';
      if (url === git + 'matching-refs/documents/') return Response.json([{ ref: 'refs/documents/workspace-a', object: { sha: 'c'.repeat(40), type: 'commit' } }]);
      if (url === git + 'matching-refs/dolt/') return Response.json([{ ref: 'refs/dolt/workspace-a', object: { sha: 'e'.repeat(40), type: 'commit' } }]);
      if (url === git + 'commits/' + 'c'.repeat(40)) return Response.json({ sha: 'c'.repeat(40), tree: { sha: 'd'.repeat(40) } });
      if (url === git + 'commits/' + 'e'.repeat(40)) return Response.json({ sha: 'e'.repeat(40), tree: { sha: 'f'.repeat(40) } });
      const note = await blob(document), storage = await blob(manifest), workspace = await blob(workspaceManifest);
      if (url === git + 'trees/' + 'd'.repeat(40) + '?recursive=1') return Response.json({ sha: 'd'.repeat(40), truncated: false, tree: [{ path: 'documents/notes/private.md', mode: '100644', type: 'blob', sha: note.sha, size: note.size }, { path: 'documents/workspace/manifest.json', mode: '100644', type: 'blob', sha: workspace.sha, size: workspace.size }] });
      if (url === git + 'trees/' + 'f'.repeat(40) + '?recursive=1') return Response.json({ sha: 'f'.repeat(40), truncated: false, tree: [{ path: 'manifest', mode: '100644', type: 'blob', sha: storage.sha, size: storage.size }] });
      if (url === git + 'blobs/' + note.sha) return Response.json(note);
      if (url === git + 'blobs/' + storage.sha) return Response.json(storage);
      if (url === git + 'blobs/' + workspace.sha) return Response.json(workspace);
      return Response.json({}, { status: 404 });
    };
  });
}
test.beforeEach(async () => { profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-connections-')); });
test.afterEach(async () => { await context?.close(); await rm(profile, { recursive: true, force: true }); });
async function serveHosted() {
  await context.route('https://mickmister.github.io/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const app = pathname.indexOf('/app/');
    if (app >= 0) {
      const name = pathname.slice(app + '/app/'.length) || 'index.html';
      if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf)$/.test(name)) return route.fulfill({ status: 404, body: 'Not found' });
      return route.fulfill({ path: resolve('hosted-dist/app', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    }
    const name = pathname.split('/').pop() || 'index.html';
    if (!['index.html', 'settings.html', 'build.json'].includes(name) && !/^(main|settings|shared|beads|documents)-[A-Z0-9]+\.(js|css)$/.test(name)) return route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html' });
  });
}

test('packaged settings page authenticates, reads privately, refreshes, persists and isolates local connections', async () => {
  const id = await launch();
  let page = await context.newPage();
  await page.goto(`chrome-extension://${id}/connections.html`);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('App ID', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Public Client ID')).toHaveValue('');
  await fillApp(page);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  let first = page.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await first.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(first).toContainText('BROW-SER1');
  await expect(first).toContainText('Signed in as mickmister', { timeout: 15000 });
  await first.getByRole('button', { name: 'Load installations' }).click();
  await first.getByRole('button', { name: 'Use mickmister' }).click();
  await expect(first.getByLabel('Repository to read')).toHaveValue('');
  await expect(first.getByLabel('Hosted origin to approve')).toHaveValue('');
  await first.getByLabel('Repository to read').fill('mickmister/workspace-storage');
  await first.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(first.getByLabel('Read results')).toContainText('"private": true');
  await expect(first.getByLabel('Read results')).toContainText('b'.repeat(40));
  await first.getByRole('button', { name: 'Refresh credentials' }).click();
  await expect(page.getByRole('status')).toContainText('Credentials refreshed');
  await first.getByLabel('Repository to read').fill('mickmister/workspace-storage');
  await first.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Repository read succeeded');
  await expect(page.locator('body')).not.toContainText('ghu_browser_secret');
  await expect(page.locator('body')).not.toContainText('ghr_browser_secret');
  await expect(page.locator('body')).not.toContainText('private-device-secret');

  // A real browser restart exercises extension-origin IndexedDB, not a mocked
  // settings store or an in-memory broker surviving page reload.
  await context.close();
  const sameId = await launch(); expect(sameId).toBe(id);
  page = await context.newPage(); await page.goto(`chrome-extension://${id}/connections.html`);
  first = page.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await expect(first).toContainText('Signed in as mickmister');
  await first.getByLabel('Repository to read').fill('mickmister/workspace-storage');
  await first.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Repository read succeeded');

  await fillApp(page, 'Second connection');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const second = page.getByRole('article', { name: 'Second connection', exact: true });
  await second.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(second).toContainText('Signed in as mickmister', { timeout: 15000 });
  await second.getByRole('button', { name: 'Load installations' }).click();
  await second.getByRole('button', { name: 'Use mickmister' }).click();
  await first.getByRole('button', { name: 'Disconnect locally' }).click();
  await expect(first.getByRole('button', { name: 'Sign in with device code' })).toBeVisible();
  await second.getByLabel('Repository to read').fill('mickmister/workspace-storage');
  await second.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(second.getByLabel('Read results')).toContainText('b'.repeat(40));
  expect(await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).not.toMatch(/ghu_|ghr_|private-device/);
});

test('GitHub content scripts cannot invoke the privileged connections broker', async () => {
  await launch();
  await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>GitHub fixture</title><main>Issue</main>' }));
  const page = await context.newPage(); await page.goto('https://github.com/owner/repo/issues/1');
  const session = await context.newCDPSession(page);
  const worlds: Array<{ id: number; origin: string }> = [];
  session.on('Runtime.executionContextCreated', event => worlds.push(event.context));
  await session.send('Runtime.enable');
  await expect.poll(() => worlds.some(world => world.origin.startsWith('chrome-extension://'))).toBe(true);
  const world = worlds.find(world => world.origin.startsWith('chrome-extension://'))!;
  const result = await session.send('Runtime.evaluate', {
    contextId: world.id, awaitPromise: true, returnByValue: true,
    expression: `chrome.runtime.sendMessage({channel:'github-ultimate-connections-v1',request:{operation:'list'}}).then(value => value === undefined ? 'denied' : value, () => 'denied')`,
  });
  expect(result.result.value).toBe('denied');
});

test('hosted branch page reads through an approved connection and revocation takes effect in an already open tab', async () => {
  test.setTimeout(60000);
  const id = await launch(true);
  await serveHosted();
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  await fillApp(settings);
  await settings.getByRole('button', { name: 'Add connection', exact: true }).click();
  const card = settings.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await card.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(card).toContainText('Signed in as mickmister', { timeout: 15000 });
  await card.getByRole('button', { name: 'Load installations' }).click(); await card.getByRole('button', { name: 'Use mickmister' }).click();
  const page = await context.newPage(); await page.goto('https://mickmister.github.io/github-ultimate/previews/test-branch/settings.html');
  await expect(page.getByRole('status')).toContainText('No bridge response', { timeout: 10000 });
  await card.getByLabel('Hosted origin to approve').fill('https://mickmister.github.io');
  await card.getByRole('button', { name: 'Grant hosted read access' }).click();
  await expect(settings.getByRole('status')).toContainText('Hosted read access granted');
  await expect(card.getByRole('button', { name: 'Bind workspace', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('1 approved connection');
  await expect(page.getByRole('button', { name: 'Read repository', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Repository (owner/name)')).toHaveValue('');
  await page.getByLabel('Repository (owner/name)').fill('mickmister/workspace-storage');
  const worker = context.serviceWorkers()[0];
  const beforeInvalid = await worker.evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length);
  const invalid = await page.evaluate(() => new Promise<{ ok: boolean; error: string }>(resolve => {
    const requestId = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.data?.channel !== 'github-ultimate-extension-v1' || event.data.requestId !== requestId) return;
      window.removeEventListener('message', receive); resolve(event.data);
    };
    window.addEventListener('message', receive);
    // A request from the older cached page omitted installationId. It used to
    // be dropped silently by the relay before any background/network activity.
    window.postMessage({ channel: 'github-ultimate-page-v1', version: 1, requestId, request: { operation: 'gitRefs', id: (document.getElementById('connection') as HTMLSelectElement).value, repository: 'mickmister/workspace-storage', prefix: 'documents/' } }, location.origin);
  }));
  expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining('incompatible') });
  expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length)).toBe(beforeInvalid);
  await page.getByLabel('Approved connection').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByLabel('Read result')).toContainText('"private": true');
  await expect(page.getByLabel('Read result')).toContainText('b'.repeat(40));
  await page.getByRole('button', { name: 'Discover workspaces' }).click();
  await expect(page.getByRole('status')).toContainText('1 stored workspace');
  await expect(page.locator('#workspace-status')).toContainText('1 stored workspace');
  expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.filter(url => url.includes('/git/matching-refs/')).length)).toBe(2);
  await page.getByLabel('Stored workspace').selectOption('workspace-a');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Document list loaded');
  await expect(page.locator('#snapshot-info')).toContainText('Explore product requirements before choosing source repositories');
  await page.getByLabel('Document or nugget').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(page.getByLabel('Document content')).toContainText('<script>window.__unsafeDocument = true</script>');
  expect(await page.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  await page.getByRole('button', { name: 'Inspect Beads snapshot' }).click();
  await expect(page.locator('#beads-info')).toContainText('Only the manifest bytes were fetched and verified');
  await expect(page.locator('#beads-info')).toContainText('Issue queries are not available yet');
  await expect(page.locator('body')).not.toContainText('ghu_browser_secret');
  const preferences = await page.evaluate(() => ({ values: Object.values(localStorage), session: sessionStorage.length }));
  expect(preferences.values).toHaveLength(1); expect(preferences.session).toBe(0);
  expect(JSON.parse(preferences.values[0])).toMatchObject({ repository: 'mickmister/workspace-storage', workspace: 'workspace-a', installationId: 123 });
  expect(preferences.values.join('')).not.toMatch(/Private workspace note|unsafeDocument|ghu_|ghr_/);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Document list loaded');
  await expect(page.getByLabel('Stored workspace')).toHaveValue('workspace-a');
  await expect(page.getByLabel('Document content')).not.toContainText('Private workspace note');
  await page.getByLabel('Document or nugget').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(page.getByLabel('Document content')).toContainText('Private workspace note');
  const dashboard = await context.newPage();
  await dashboard.goto('https://mickmister.github.io/github-ultimate/previews/test-branch/');
  await expect(dashboard.getByRole('heading', { name: 'workspace-a', exact: true })).toBeVisible();
  await expect(dashboard.getByRole('heading', { name: 'Beads', exact: true })).toBeVisible();
  await expect(dashboard.locator('.app-view')).toContainText('Storage manifest verified');
  await expect(dashboard.locator('.app-view')).toContainText('no issue query has run');
  await expect(dashboard.getByRole('link', { name: 'Open in github.dev', exact: true })).toHaveAttribute('href', `https://github.dev/mickmister/workspace-storage/tree/${'c'.repeat(40)}/documents`);
  await dashboard.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(dashboard.getByRole('link', { name: 'notes/private.md', exact: true })).toHaveAttribute('href', `https://github.dev/mickmister/workspace-storage/blob/${'c'.repeat(40)}/documents/notes/private.md`);
  await dashboard.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(dashboard.getByRole('heading', { name: 'Connection & storage settings', exact: true })).toBeVisible();
  await dashboard.close();
  // The new Start SPA is served entirely from static files under its real
  // branch base path, and uses the same approved extension/verified Git reader.
  const shell = await readFile(resolve('hosted-dist/app/index.html'), 'utf8');
  expect(shell).not.toContain('Choose your workspace');
  const appPath = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
  const modern = await context.newPage();
  const pageErrors: string[] = []; modern.on('pageerror', error => pageErrors.push(error.message));
  const workerURLs: string[] = []; modern.on('worker', worker => workerURLs.push(worker.url()));
  await modern.goto('https://mickmister.github.io' + appPath);
  await expect(modern.getByRole('heading', { name: 'Workspace documents', exact: true })).toBeVisible();
  await expect(modern.getByLabel('Storage repository')).toHaveValue('');
  await expect(modern.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
  await modern.getByLabel('Storage repository').fill('mickmister/workspace-storage');
  await expect(modern.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeEnabled();
  await modern.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
  await expect(modern.getByRole('status')).toContainText('1 workspace(s) found');
  await modern.getByLabel('Stored workspace').selectOption('workspace-a');
  await modern.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await expect(modern.getByRole('status')).toContainText('2 document(s)');
  await modern.getByRole('treeitem', { name: 'notes', exact: true }).click();
  await modern.getByRole('treeitem', { name: 'notes/private.md', exact: true }).click();
  await expect(modern.getByLabel('Markdown preview', { exact: true })).toContainText('Private workspace note');
  const documentURL = new URL(modern.url());
  expect(documentURL.pathname).toBe(appPath);
  expect(documentURL.hash).toMatch(/^#\/documents\/[^?]+\?/);
  expect(new URLSearchParams(documentURL.hash.split('?')[1]).get('workspace')).toBe('workspace-a');
  expect(new URLSearchParams(documentURL.hash.split('?')[1]).get('repository')).toBe('mickmister/workspace-storage');
  // A fresh page and a reload must reconstruct the same approved workspace and document.
  const linked = await context.newPage();
  await linked.goto(documentURL.href);
  await expect(linked.getByLabel('Markdown preview', { exact: true })).toContainText('Private workspace note');
  await linked.reload();
  await expect(linked.getByLabel('Markdown preview', { exact: true })).toContainText('Private workspace note');
  await linked.close();
  await modern.goBack();
  await expect(modern.getByRole('tree', { name: 'Documents', exact: true })).toBeVisible();
  await modern.goForward();
  await expect(modern.getByLabel('Markdown preview', { exact: true })).toContainText('Private workspace note');
  await expect(modern.locator('.document-fullscreen')).toBeVisible();
  await expect(modern.getByRole('tree')).toHaveCount(0);
  expect(await modern.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  await expect(modern.getByLabel('Markdown preview', { exact: true }).locator('script')).toHaveCount(0);
  await modern.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(modern.locator('[data-editor-ready=true]')).toBeVisible();
  await expect(modern.getByLabel('Document content')).toContainText('Private workspace note');
  await modern.getByRole('button', { name: 'Back to documents' }).click();
  await modern.getByRole('treeitem', { name: 'workspace', exact: true }).click();
  await modern.getByRole('treeitem', { name: 'workspace/manifest.json', exact: true }).click();
  await expect(modern.locator('[data-editor-ready=true]')).toBeVisible();
  await expect.poll(() => workerURLs.some(url => url.includes('json.worker'))).toBe(true);
  expect(workerURLs.every(url => url.startsWith('https://mickmister.github.io/'))).toBe(true);
  await expect(modern.getByRole('button', { name: 'Markdown preview', exact: true })).toHaveCount(0);
  const returning = await context.newPage();
  await returning.goto('https://mickmister.github.io' + appPath);
  await expect(returning.getByLabel('Document content')).toContainText('Explore product requirements');
  await expect(returning.locator('.document-fullscreen')).toBeVisible();
  await returning.close();
  await modern.getByRole('button', { name: 'Back to documents' }).click();
  await modern.getByLabel('Find a document').fill('no-match');
  await expect(modern.getByText('No documents match this search.')).toBeVisible();
  await modern.setViewportSize({ width: 375, height: 812 });
  expect(await modern.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A new landing visit resumes the workspace without a Discover click. Clear
  // page preferences too: the extension independently remembers this scope.
  await modern.evaluate(() => localStorage.removeItem(`github-ultimate-workspace-v1:${location.pathname}`));
  await modern.goto('https://mickmister.github.io' + appPath);
  await expect(modern.getByLabel('Document content')).toContainText('Explore product requirements');
  await modern.getByRole('button', { name: 'Back to documents' }).click();
  await expect(modern.getByRole('tree', { name: 'Documents', exact: true })).toBeVisible();
  await expect(modern.getByLabel('Stored workspace')).toHaveValue('workspace-a');
  await expect(modern.getByLabel('Storage repository')).toHaveValue('mickmister/workspace-storage');
  await modern.getByRole('button', { name: 'Forget saved workspace', exact: true }).click();
  await expect(modern.getByRole('status')).toContainText('Saved workspace forgotten');
  await modern.goto('https://mickmister.github.io' + appPath);
  await expect(modern.getByLabel('Storage repository')).toHaveValue('');
  await expect(modern.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
  expect(pageErrors).toEqual([]);
  await modern.close();
  await settings.getByRole('button', { name: 'Revoke https://mickmister.github.io' }).click();
  await page.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('no approved connections');
  await expect(page.getByLabel('Document content')).not.toContainText('Private workspace note');
  await page.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('no approved connections');
  await expect(page.getByLabel('Read result')).not.toContainText('"private": true');
  await page.getByRole('button', { name: 'Forget saved selections' }).click();
  await expect(page.getByLabel('Repository (owner/name)')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('load-time document scope cannot be changed by earliest inline history rewrites or later SPA navigation', async () => {
  test.setTimeout(60000);
  const id = await launch(true);
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  await fillApp(settings);
  await settings.getByRole('button', { name: 'Add connection', exact: true }).click();
  const card = settings.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await card.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(card).toContainText('Signed in as mickmister', { timeout: 15000 });
  await card.getByRole('button', { name: 'Load installations' }).click(); await card.getByRole('button', { name: 'Use mickmister' }).click();
  await card.getByLabel('Hosted origin to approve').fill('https://mickmister.github.io');
  await card.getByLabel('Hosted subpath').fill('/allowed/');
  await card.getByRole('button', { name: 'Grant hosted read access' }).click();
  await expect(settings.getByRole('status')).toContainText('Hosted read access granted');
  await context.route('https://mickmister.github.io/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script>if(location.pathname.startsWith("/blocked/"))history.replaceState({},"","/allowed/")</script><h1>Path fixture</h1>' }));
  const call = (page: Page, request: object = { operation: 'discover' }) => page.evaluate(request => new Promise<{ ok: boolean; error?: string; result?: unknown }>(resolve => {
    const requestId = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.data?.channel !== 'github-ultimate-extension-v1' || event.data.requestId !== requestId) return;
      window.removeEventListener('message', receive); resolve(event.data);
    };
    window.addEventListener('message', receive);
    window.postMessage({ channel: 'github-ultimate-page-v1', version: 1, requestId, request }, location.origin);
  }), request);
  const blocked = await context.newPage(); await blocked.goto('https://mickmister.github.io/blocked/');
  expect(new URL(blocked.url()).pathname).toBe('/allowed/');
  expect(await call(blocked)).toMatchObject({ ok: false, error: expect.stringContaining('no approved') });
  expect(await call(blocked, { operation: 'discover', documentURL: 'https://mickmister.github.io/allowed/' })).toMatchObject({ ok: false, error: expect.stringContaining('incompatible') });
  const allowed = await context.newPage(); await allowed.goto('https://mickmister.github.io/allowed/');
  expect(await call(allowed)).toMatchObject({ ok: true });
  await allowed.evaluate(() => history.pushState({}, '', '/outside/'));
  expect(await call(allowed)).toMatchObject({ ok: true });
  await allowed.reload();
  expect(await call(allowed)).toMatchObject({ ok: false, error: expect.stringContaining('no approved') });
  const before = await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length);
  await card.getByRole('button', { name: 'Revoke https://mickmister.github.io/allowed/', exact: true }).click();
  expect(await call(blocked)).toMatchObject({ ok: false, error: expect.stringContaining('no approved') });
  expect(await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length)).toBe(before);
});

test('an older injected relay fails visibly during automatic connection before any GitHub request', async () => {
  await launch(true); await serveHosted();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.data?.channel !== 'github-ultimate-page-v1') return;
      window.postMessage({ channel: 'github-ultimate-extension-v1', version: 1, requestId: event.data.requestId, ok: true, result: { protocolVersion: 1, capabilities: [] } }, location.origin);
    });
  });
  await page.goto('https://mickmister.github.io/github-ultimate/previews/old-relay/settings.html');
  await expect(page.locator('#workspace-status')).toContainText('relay is outdated');
  await expect(page.getByRole('button', { name: 'Discover workspaces' })).toBeDisabled();
  expect(await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length)).toBe(0);
});

test('automatic restore does not replace an unavailable saved connection with another App', async () => {
  await launch(true); await serveHosted();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const saved = { connectionId: '11111111-1111-4111-8111-111111111111', installationId: 123, repository: 'owner/storage', workspace: 'planning', discovered: true };
    localStorage.setItem(`github-ultimate-navigation-v1:${location.pathname.replace(/settings\.html$/, '')}`, JSON.stringify(saved));
    window.addEventListener('message', event => {
      if (event.data?.channel !== 'github-ultimate-page-v1') return;
      const result = event.data.request.operation === 'connections' ? [{ id: '22222222-2222-4222-8222-222222222222', name: 'Other App', appId: 999, installation: { id: 456, account: 'other' } }] : { protocolVersion: 1, capabilities: [] };
      window.postMessage({ channel: 'github-ultimate-extension-v1', version: 1, relayRevision: 3, requestId: event.data.requestId, ok: true, result }, location.origin);
    });
  });
  await page.goto('https://mickmister.github.io/github-ultimate/previews/saved-connection/settings.html');
  await expect(page.locator('#workspace-status')).toContainText('saved connection is unavailable');
  await expect(page.getByLabel('Approved connection')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Discover workspaces' })).toBeDisabled();
  expect(await context.serviceWorkers()[0].evaluate(() => (globalThis as typeof globalThis & { __githubRequests: string[] }).__githubRequests.length)).toBe(0);
});

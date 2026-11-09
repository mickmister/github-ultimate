import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let context: BrowserContext, profile: string;
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
    const document = '<script>window.__unsafeDocument = true</script>\nPrivate workspace note';
    const manifest = `5:__DOLT__:${'0'.repeat(32)}:${'1'.repeat(32)}:${'0'.repeat(32)}`;
    const blob = async (content: string) => {
      const bytes = new TextEncoder().encode(content);
      const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
      const object = new Uint8Array(header.length + bytes.length); object.set(header); object.set(bytes, header.length);
      const hash = await crypto.subtle.digest('SHA-1', object);
      return { sha: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''), size: bytes.length, encoding: 'base64', content: btoa(content) };
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url === 'https://github.com/login/device/code') return Response.json({ device_code: 'private-device-secret', user_code: 'BROW-SER1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (url === 'https://github.com/login/oauth/access_token') {
        serial++;
        return Response.json({ access_token: `ghu_browser_secret_${serial}`, refresh_token: `ghr_browser_secret_${serial}`, token_type: 'bearer', expires_in: 28800, refresh_token_expires_in: 15897600 });
      }
      if (!(init.headers as Record<string, string>)?.Authorization?.startsWith('Bearer ghu_browser_secret_')) return Response.json({}, { status: 401 });
      if (url === 'https://api.github.com/user') return Response.json({ login: 'mickmister', id: 1 });
      if (url.startsWith('https://api.github.com/user/installations?')) return Response.json({ installations: [{ id: 123, app_id: 5684700, account: { login: 'mickmister' }, permissions: { contents: 'read', metadata: 'read', actions: 'write' } }] });
      if (url.startsWith('https://api.github.com/user/installations/123/repositories?')) return Response.json({ repositories: [{ full_name: 'mickmister/workspace-storage', private: true, default_branch: 'main' }] });
      if (url === 'https://api.github.com/repos/mickmister/workspace-storage/git/ref/heads/main') return Response.json({ object: { sha: 'b'.repeat(40), type: 'commit' } });
      const git = 'https://api.github.com/repos/mickmister/workspace-storage/git/';
      if (url === git + 'matching-refs/documents/') return Response.json([{ ref: 'refs/documents/workspace-a', object: { sha: 'c'.repeat(40), type: 'commit' } }]);
      if (url === git + 'matching-refs/dolt/') return Response.json([{ ref: 'refs/dolt/workspace-a', object: { sha: 'e'.repeat(40), type: 'commit' } }]);
      if (url === git + 'commits/' + 'c'.repeat(40)) return Response.json({ sha: 'c'.repeat(40), tree: { sha: 'd'.repeat(40) } });
      if (url === git + 'commits/' + 'e'.repeat(40)) return Response.json({ sha: 'e'.repeat(40), tree: { sha: 'f'.repeat(40) } });
      const note = await blob(document), storage = await blob(manifest);
      if (url === git + 'trees/' + 'd'.repeat(40) + '?recursive=1') return Response.json({ sha: 'd'.repeat(40), truncated: false, tree: [{ path: 'documents/notes/private.md', mode: '100644', type: 'blob', sha: note.sha, size: note.size }] });
      if (url === git + 'trees/' + 'f'.repeat(40) + '?recursive=1') return Response.json({ sha: 'f'.repeat(40), truncated: false, tree: [{ path: 'manifest', mode: '100644', type: 'blob', sha: storage.sha, size: storage.size }] });
      if (url === git + 'blobs/' + note.sha) return Response.json(note);
      if (url === git + 'blobs/' + storage.sha) return Response.json(storage);
      return Response.json({}, { status: 404 });
    };
  });
}
test.beforeEach(async () => { profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-connections-')); });
test.afterEach(async () => { await context?.close(); await rm(profile, { recursive: true, force: true }); });

test('packaged settings page authenticates, reads privately, refreshes, persists and isolates local connections', async () => {
  const id = await launch();
  let page = await context.newPage();
  await page.goto(`chrome-extension://${id}/connections.html`);
  await expect(page.getByLabel('Public Client ID')).toHaveValue('Iv23liGu3PxdoBoqgLiD');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  let first = page.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await first.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(first).toContainText('BROW-SER1');
  await expect(first).toContainText('Signed in as mickmister', { timeout: 15000 });
  await first.getByRole('button', { name: 'Load installations' }).click();
  await first.getByRole('button', { name: 'Use mickmister' }).click();
  await first.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(first.getByLabel('Read results')).toContainText('"private": true');
  await expect(first.getByLabel('Read results')).toContainText('b'.repeat(40));
  await first.getByRole('button', { name: 'Refresh credentials' }).click();
  await expect(page.getByRole('status')).toContainText('Credentials refreshed');
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
  await first.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Repository read succeeded');

  await page.getByLabel('Name', { exact: true }).fill('Second connection');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const second = page.getByRole('article', { name: 'Second connection', exact: true });
  await second.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(second).toContainText('Signed in as mickmister', { timeout: 15000 });
  await second.getByRole('button', { name: 'Load installations' }).click();
  await second.getByRole('button', { name: 'Use mickmister' }).click();
  await first.getByRole('button', { name: 'Disconnect locally' }).click();
  await expect(first.getByRole('button', { name: 'Sign in with device code' })).toBeVisible();
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
  await context.route('https://mickmister.github.io/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
    if (!['index.html', 'main.js', 'main.css', 'build.json'].includes(name)) return route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ path: resolve('hosted-dist', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html' });
  });
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/connections.html`);
  await settings.getByRole('button', { name: 'Add connection', exact: true }).click();
  const card = settings.getByRole('article', { name: 'GitHub Ultimate client', exact: true });
  await card.getByRole('button', { name: 'Sign in with device code' }).click();
  await expect(card).toContainText('Signed in as mickmister', { timeout: 15000 });
  await card.getByRole('button', { name: 'Load installations' }).click(); await card.getByRole('button', { name: 'Use mickmister' }).click();
  const page = await context.newPage(); await page.goto('https://mickmister.github.io/github-ultimate/previews/test-branch/');
  await page.getByRole('button', { name: 'Connect to extension' }).click();
  await expect(page.getByRole('status')).toContainText('No bridge response', { timeout: 10000 });
  await card.getByRole('button', { name: 'Grant hosted read access' }).click();
  await expect(settings.getByRole('status')).toContainText('Hosted read access granted');
  await card.getByLabel('Workspace namespace to bind').fill('workspace-a');
  await card.getByRole('button', { name: 'Bind workspace', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Workspace bound');
  await page.reload(); await page.getByRole('button', { name: 'Connect to extension' }).click();
  await expect(page.getByRole('status')).toContainText('1 approved connection');
  await expect(page.getByRole('button', { name: 'Read repository', exact: true })).toBeDisabled();
  await page.getByLabel('Approved connection').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByLabel('Read result')).toContainText('"private": true');
  await expect(page.getByLabel('Read result')).toContainText('b'.repeat(40));
  await page.getByRole('button', { name: 'Discover workspaces' }).click();
  await expect(page.getByRole('status')).toContainText('1 stored workspace');
  await page.getByLabel('Stored workspace').selectOption('workspace-a');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Document list loaded');
  await page.getByLabel('Document or nugget').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(page.getByLabel('Document content')).toContainText('<script>window.__unsafeDocument = true</script>');
  expect(await page.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  await page.getByRole('button', { name: 'Inspect Beads snapshot' }).click();
  await expect(page.locator('#beads-info')).toContainText('Only the manifest bytes were fetched and verified');
  await expect(page.locator('#beads-info')).toContainText('Issue queries are not available yet');
  await expect(page.locator('body')).not.toContainText('ghu_browser_secret');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await settings.getByRole('button', { name: 'Revoke https://mickmister.github.io' }).click();
  await page.getByRole('button', { name: 'Read document', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('no approved connections');
  await expect(page.getByLabel('Document content')).not.toContainText('Private workspace note');
  await page.getByRole('button', { name: 'Read repository', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('no approved connections');
  await expect(page.getByLabel('Read result')).not.toContainText('"private": true');
});

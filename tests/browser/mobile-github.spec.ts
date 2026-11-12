import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Connections } from '../../src/connections';
import { MobileConnectionStore } from '../../src/mobile-connection-store';
import { MobileGitHub } from '../../src/mobile-github';
import { grantForEntry, MobileFixtureBroker } from '../../src/mobile-protocol';

test('hosted app reads a private document over Alohak RPC without extension fallback or credential disclosure', async ({ browser }) => {
  const shell = await readFile(resolve('hosted-dist/app/index.html'), 'utf8');
  const appPath = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
  const entry = 'https://pages.example' + appPath;
  const metadata = new Map<string, string>(), secrets = new Map<string, string>();
  const store = new MobileConnectionStore({ async getItem(key) { return metadata.get(key) ?? null; }, async setItem(key, value) { metadata.set(key, value); } }, { async getItem(key) { return secrets.get(key) ?? null; }, async setItem(key, value) { secrets.set(key, value); }, async removeItem(key) { secrets.delete(key); } }, randomUUID);
  const id = randomUUID();
  await store.put({ id, name: 'My chosen App', appId: 123, clientId: 'IvMyApp', user: { id: 1, login: 'owner' }, installation: { id: 7, account: 'owner' }, hostedGrants: [grantForEntry(entry)], tokens: { accessToken: 'ghu_private_native_token', refreshToken: 'ghr_private_native_token', expiresAt: Date.now() + 1e6, refreshExpiresAt: Date.now() + 1e9 } });
  const content = '# Alohak private note\n\nLoaded through the native host.';
  const sha = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
  const manifest = JSON.stringify({ schema_version: 1, workspace: 'workspace-a', observed_at: '2026-11-12T00:00:00Z', purpose: 'Alohak private read acceptance' });
  const manifestSha = createHash('sha1').update(`blob ${Buffer.byteLength(manifest)}\0${manifest}`).digest('hex');
  const calls: string[] = [];
  const engine = new Connections(store, async (input, init) => {
    const url = String(input); calls.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ghu_private_native_token');
    if (url.includes('/user/installations/7/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/private', private: true, default_branch: 'main' }] });
    if (url.endsWith('/matching-refs/documents/')) return Response.json([{ ref: 'refs/documents/workspace-a', object: { sha: 'c'.repeat(40), type: 'commit' } }]);
    if (url.endsWith('/matching-refs/dolt/')) return Response.json([]);
    if (url.endsWith('/commits/' + 'c'.repeat(40))) return Response.json({ sha: 'c'.repeat(40), tree: { sha: 'd'.repeat(40) } });
    if (url.endsWith('/trees/' + 'd'.repeat(40) + '?recursive=1')) return Response.json({ sha: 'd'.repeat(40), truncated: false, tree: [{ path: 'documents/notes/private.md', mode: '100644', type: 'blob', sha, size: Buffer.byteLength(content) }, { path: 'documents/workspace/manifest.json', mode: '100644', type: 'blob', sha: manifestSha, size: Buffer.byteLength(manifest) }] });
    if (url.endsWith('/blobs/' + sha)) return Response.json({ sha, size: Buffer.byteLength(content), encoding: 'base64', content: Buffer.from(content).toString('base64') });
    if (url.endsWith('/blobs/' + manifestSha)) return Response.json({ sha: manifestSha, size: Buffer.byteLength(manifest), encoding: 'base64', content: Buffer.from(manifest).toString('base64') });
    throw new Error(`Unexpected fixture route ${url}`);
  });
  const github = new MobileGitHub(engine, () => true);
  const broker = new MobileFixtureBroker(undefined, github);
  const native = { documentId: 'fixture-native-document', documentURL: entry, isMainFrame: true }; broker.activate(native);
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 Alohak/1' });
  try {
    await context.route('https://pages.example/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith(appPath)) return route.fulfill({ status: 404 });
      const name = pathname.slice(appPath.length) || 'index.html';
      if (name !== 'index.html' && !/^assets\/[\w.-]+\.(js|css|ttf)$/.test(name)) return route.fulfill({ status: 404 });
      await route.fulfill({ path: resolve('hosted-dist/app', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    const page = await context.newPage();
    await page.exposeFunction('fixtureNativeRPC', (raw: string) => broker.handleAsync(native, raw));
    await page.addInitScript(() => {
      const host = window as unknown as Window & { fixtureNativeRPC(raw: string): Promise<unknown>; extensionAttempts: number };
      host.extensionAttempts = 0;
      window.addEventListener('message', event => { if (event.data?.channel === 'github-ultimate-page-v1') host.extensionAttempts++; });
      // Exercise waiting for native bootstrap during initial application startup.
      setTimeout(() => {
        window.alohakNative = { protocolVersion: 1, documentId: 'fixture-native-document', postMessage(raw) {
          void host.fixtureNativeRPC(raw).then(reply => window.dispatchEvent(new CustomEvent('alohak-native-message', { detail: JSON.stringify(reply) })));
        } };
        window.dispatchEvent(new Event('alohak-native-ready'));
      }, 1500);
    });
    await page.goto(entry);
    await expect(page.getByRole('status')).toContainText('Connected. Choose a repository');
    await page.getByLabel('Storage repository').fill('owner/private');
    await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('1 workspace(s) found');
    await page.getByLabel('Stored workspace').selectOption('workspace-a');
    await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('2 document(s)');
    await page.getByRole('treeitem', { name: 'notes', exact: true }).click();
    await page.getByRole('treeitem', { name: 'notes/private.md', exact: true }).click();
    await expect(page.getByLabel('Markdown preview', { exact: true })).toContainText('Alohak private note');
    await page.reload();
    await expect(page.getByLabel('Markdown preview', { exact: true })).toContainText('Alohak private note');
    expect(await page.evaluate(() => (window as unknown as Window & { extensionAttempts: number }).extensionAttempts)).toBe(0);
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, body: document.body.innerText }))).not.toMatch(/ghu_|ghr_/);
    expect(calls.some(url => url.endsWith('/blobs/' + sha))).toBe(true);
    await github.settings({ operation: 'revokeOrigin', id, ...grantForEntry(entry) });
    await page.reload();
    await expect(page.locator('body')).toContainText('no approved connections');
    await expect(page.getByLabel('Markdown preview', { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

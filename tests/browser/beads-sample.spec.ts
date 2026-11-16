import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitReadSchema, readGit } from '../../src/git-reads';
import { pageChannel, replyChannel, hostedRelayRevision } from '../../src/bridge-channels';
// Live private native bytes must not enter trace/network artifacts.
test.use({ trace: 'off' });

async function serve(page: Page) {
  const shell = await readFile('hosted-dist/app/index.html', 'utf8');
  const base = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
  await page.route('https://mickmister.github.io/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith(base)) return route.fulfill({ status: 404 });
    const file = pathname.slice(base.length) || 'index.html';
    if (file !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf)$/.test(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ path: resolve('hosted-dist/app', file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
  });
  return 'https://mickmister.github.io' + base;
}

test('native Beads page is reachable and requires an approved workspace connection', async ({ page }) => {
  test.setTimeout(45000);
  const base = await serve(page);
  await page.goto(base + '#/beads');
  await expect(page.getByRole('heading', { name: 'Kanban', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No bridge response', { timeout: 35000 });
  await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeDisabled();
});

test.describe('real selected workspace / published CDN engine', () => {
  // Opt-in: private native bytes remain in memory and are never test artifacts.
  test('executes list, ready and blocked against authenticated native Git blobs', async ({ page }, info) => {
    test.skip(!process.env.BEADS_LIVE_WORKSPACE, 'Requires an explicit workspace and authorized gh CLI; CI uses public fixtures in the engine repository.');
    test.setTimeout(360000);
    const workspace = process.env.BEADS_LIVE_WORKSPACE!, repository = process.env.BEADS_LIVE_REPOSITORY ?? 'mickmister/workspace-storage';
    const connection = '11111111-1111-4111-8111-111111111111', api = new Map<string, Promise<unknown>>();
    let parts = 0, activeNativeHTTP = 0, maxNativeHTTP = 0;
    await page.exposeFunction('__beadsNativeRead', async (input: unknown) => {
      const request = input as { operation: string };
      if (request.operation === 'connections') return [{ id: connection, name: 'Authorized live-workspace proof', appId: 1, installation: { id: 1, account: 'mickmister' } }];
      if (request.operation === 'discover') return { capabilities: ['gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'gitBlobPart', 'implicitWorkspaces'] };
      const read = gitReadSchema.parse(input);
      expect(read.id).toBe(connection); expect(read.installationId).toBe(1); expect(read.repository).toBe(repository);
      if ('workspace' in read) expect(read.workspace).toBe(workspace);
      if (read.operation === 'gitBlobPart') parts++;
      return readGit(read, repository, async path => {
        if (!api.has(path)) {
          const native = 'namespace' in read && read.namespace === 'dolt' && path.includes('/blobs/');
          if (native) maxNativeHTTP = Math.max(maxNativeHTTP, ++activeNativeHTTP);
          api.set(path, promisify(execFile)('gh', ['api', path], { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 }).then(value => JSON.parse(value.stdout)).finally(() => { if (native) activeNativeHTTP--; }));
        }
        return api.get(path)!;
      });
    });
    await page.addInitScript(({ channel, reply, revision }) => {
      window.addEventListener('message', async event => {
        const value = event.data;
        if (event.source !== window || value?.channel !== channel) return;
        try {
          const result = await (window as unknown as { __beadsNativeRead(request: unknown): Promise<unknown> }).__beadsNativeRead(value.request);
          window.postMessage({ channel: reply, version: 1, relayRevision: revision, requestId: value.requestId, ok: true, result }, location.origin);
        } catch (error) { window.postMessage({ channel: reply, version: 1, relayRevision: revision, requestId: value.requestId, ok: false, error: error instanceof Error ? error.message : 'Live native read failed.' }, location.origin); }
      });
    }, { channel: pageChannel, reply: replyChannel, revision: hostedRelayRevision });
    const base = await serve(page);
    await page.goto(base + '#/beads?' + new URLSearchParams({ connection, repository, workspace }));
    // A complete workspace link starts the reader without a load button.
    await page.waitForFunction(() => document.querySelector('[role=alert]') || document.querySelector('.beads-count'), undefined, { timeout: 300000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.beads-count')).toBeVisible();
    expect(parts).toBeGreaterThan(0);
    expect(maxNativeHTTP).toBeGreaterThan(1); expect(maxNativeHTTP).toBeLessThanOrEqual(3);
    const allCount = await page.locator('.beads-count').innerText();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('combobox', { name: /^Readiness/ }).selectOption('ready');
    const readyCount = await page.locator('.beads-count').innerText();
    await page.getByRole('combobox', { name: /^Readiness/ }).selectOption('blocked');
    const blockedCount = await page.locator('.beads-count').innerText();
    const evidence = { scope: 'Real private native Git data through authorized Node-side gh transport; actual production UI and published CDN Worker/WASM, not packaged extension authorization acceptance.', workspace, repository, blobPartRequests: parts, maxNativeHTTP, allCount, readyCount, blockedCount };
    await writeFile(info.outputPath('native-beads-proof.json'), JSON.stringify(evidence, null, 2));
    await expect(page.getByText(/Native query diagnostics|Snapshot identity|Verified engine release/)).toHaveCount(0);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[role=alert]') || document.querySelector('.beads-count'), undefined, { timeout: 300000 });
    await expect(page.locator('.beads-count')).toHaveText(blockedCount);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { archive, members, pointer, actionRun, workspaceFixture, connectionId, s3Id, revision } from '../fixtures/workflow-runs';

test('packaged extension: workspace-filtered attempts, verified S3 OTLP, real DuckDB worker and exact review pins', async ({}, testInfo) => {
  test.setTimeout(360000);
  const profile = await mkdtemp(resolve(tmpdir(), 'ghu-runs-')), extension = resolve(profile, 'extension');
  // A per-test build avoids races with other build/test suites replacing dist/.
  execFileSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, GHU_EXTENSION_OUTDIR: extension }, stdio: 'pipe' });
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://mickmister.github.io/*', 'https://storage.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    // Initialize the actual extension's IndexedDB through its supported settings
    // protocol for S3; the GitHub record represents an already signed-in user.
    const extensionId = worker.url().split('/')[2], settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/connections.html`);
    await settings.getByLabel('S3 connection name').fill('Golden telemetry');
    await settings.getByLabel('S3 endpoint', { exact: true }).fill('https://storage.example.test');
    await settings.getByLabel('S3 bucket', { exact: true }).fill('private-telemetry');
    await settings.getByLabel('S3 signing region').fill('us-east-1');
    await settings.getByLabel('S3 allowed key prefix').fill('pilot');
    await settings.getByLabel('S3 access key ID').fill('FIXTUREKEY');
    await settings.getByLabel('S3 secret access key').fill('fixture-secret');
    await settings.getByRole('button', { name: 'Save S3 connection', exact: true }).click();
    await expect(settings.locator('#s3-status')).toContainText('saved');
    const card = settings.getByRole('article', { name: 'Golden telemetry', exact: true });
    await card.getByLabel('S3 hosted origin').fill('https://mickmister.github.io');
    // App assets must run under a directory deployment, not only at /.
    const dev = Boolean(testInfo.config.configFile?.endsWith('playwright.runs.config.ts'));
    const base = dev ? '/github-ultimate/local-loop/app/' : (await readFile('hosted-dist/app/index.html', 'utf8')).match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
    await card.getByLabel('S3 hosted subpath').fill(base);
    await card.getByRole('button', { name: 'Grant hosted S3 access' }).click();
    await expect(settings.locator('#s3-status')).toContainText('grant saved');
    const fixtures = { 'workspace-a': workspaceFixture('workspace-a'), 'workspace-b': workspaceFixture('workspace-b') };
    await worker.evaluate(async ({ connectionId, base, fixtures, archive64, members, pointers, runs }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('github-ultimate-credentials');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('connections', 'readwrite');
          tx.objectStore('connections').put({ id: connectionId, name: 'Fixture GitHub', appId: 12345, clientId: 'FixtureClient', user: { id: 1, login: 'fixture' }, installation: { id: 1, account: 'fixture' }, tokens: { accessToken: 'fixture-github-token', expiresAt: Date.now() + 3600000 }, hostedGrants: [{ origin: 'https://mickmister.github.io', subpath: base }] });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      const state = globalThis as typeof globalThis & { calls: string[] }; state.calls = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)); state.calls.push(url.href);
        if (url.origin === 'https://storage.example.test') {
          const req = input as Request;
          if (!req.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=FIXTUREKEY/') || init?.credentials !== 'omit') return new Response('', { status: 403 });
          const p = pointers.find(item => url.pathname === `/private-telemetry/pilot/${item.payload_key}` || url.pathname === `/private-telemetry/pilot/${item.payload_key.replace('payload.tgz', 'receipt.json')}`);
          if (!p) return new Response('', { status: 404 });
          return url.pathname.endsWith('receipt.json') ? Response.json({ ...p, members }) : new Response(Uint8Array.from(atob(archive64), char => char.charCodeAt(0)));
        }
        if (url.origin !== 'https://api.github.com') throw Error('Unexpected endpoint');
        if (url.pathname === '/user/installations') return Response.json({ installations: [{ id: 1, app_id: 12345, account: { login: 'fixture' }, permissions: { contents: 'read', metadata: 'read', actions: 'read' } }] });
        if (url.pathname === '/user/installations/1/repositories') return Response.json({ repositories: ['example/storage', 'example/gh-agentic-workflows'].map(full_name => ({ full_name, private: true, default_branch: 'main' })) });
        if (url.pathname.includes('/git/matching-refs/documents/')) return Response.json(Object.entries(fixtures).map(([name, f]) => ({ ref: `refs/documents/${name}`, object: { sha: f.commit, type: 'commit' } })));
        if (url.pathname.includes('/git/matching-refs/')) return Response.json([]);
        if (url.pathname.includes('/git/commits/')) return Response.json({ sha: url.pathname.split('/').at(-1), tree: { sha: Object.values(fixtures).find(f => f.commit === url.pathname.split('/').at(-1))!.tree } });
        // Different workspace trees need distinct tree IDs for the broker cache.
        if (url.pathname.includes('/git/trees/')) return Response.json({ sha: url.pathname.split('/').at(-1), truncated: false, tree: Object.values(fixtures).find(f => f.tree === url.pathname.split('/').at(-1))!.entries });
        if (url.pathname.includes('/git/blobs/')) { const sha = url.pathname.split('/').at(-1)!; return Response.json(Object.values(fixtures).map(f => f.blobs[sha]).find(Boolean)); }
        const match = /\/actions\/runs\/(\d+)\/attempts\/(\d+)(\/jobs)?/.exec(url.pathname);
        if (match) return Response.json(match[3] ? { total_count: 2, jobs: [1, 2].map(id => ({ id, name: `parallel-${id}`, status: 'completed', conclusion: 'success', started_at: '2026-11-18T01:00:00Z', completed_at: '2026-11-18T01:00:10Z' })) } : runs.find(item => item.id === Number(match[1])));
        if (url.pathname.endsWith('/artifacts')) return Response.json({ total_count: 0, artifacts: [] });
        throw Error(`Unexpected fixture GitHub path ${url.pathname}`);
      };
    }, { connectionId, base, fixtures, archive64: Buffer.from(archive).toString('base64'), members, pointers: [pointer(10), pointer(20)], runs: [actionRun(10), actionRun(20), actionRun(30)] });
    await context.route('https://mickmister.github.io/**', async route => {
      const pathname = new URL(route.request().url()).pathname, file = pathname.startsWith(base) ? pathname.slice(base.length) || 'index.html' : '';
      if (dev) {
        const path = pathname.startsWith(base) ? '/' + pathname.slice(base.length) : pathname;
        const response = await route.fetch({ url: `http://127.0.0.1:3100${path}${new URL(route.request().url()).search}`, maxRetries: 2, timeout: 60000 });
        return route.fulfill({ response });
      }
      if (file !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf|wasm|gz)$/.test(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: resolve('hosted-dist/app', file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : 'text/html' });
    });
    const page = await context.newPage(), errors: string[] = []; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`https://mickmister.github.io${base}#/runs?connection=${connectionId}&repository=example%2Fstorage&workspace=workspace-a`);
    await page.getByRole('button', { name: 'Load workspace runs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fixture run 20', exact: true })).toBeVisible({ timeout: 30000 }).catch(async cause => { console.log('Fixture diagnostics', errors, await worker.evaluate(() => (globalThis as any).calls), await page.locator('body').innerText()); throw cause; });
    const names = await page.locator('.run-list h2').allTextContents(); expect(names).toEqual(['Fixture run 20', 'Fixture run 10']);
    await expect(page.locator('.run-list')).toContainText('10.0 s');
    await page.getByRole('button', { name: 'Fixture run 20', exact: true }).click();
    await expect(page.getByLabel('Workflow attempt')).toContainText('Job window: 10.0 s · summed job time: 20.0 s');
    await expect(page.getByRole('link', { name: 'Exact golden review' })).toHaveAttribute('href', /version=[a-f0-9]{40}&snapshot=a{40}/);
    await page.getByRole('button', { name: 'Load verified telemetry' }).click();
    await expect(page.getByRole('button', { name: 'Run SQL', exact: true })).toBeVisible({ timeout: 90000 });
    await page.getByLabel('SQL query', { exact: true }).fill('SELECT count(*) AS n, sum(duration_ms) AS total_ms FROM spans');
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('.run-results tbody')).toHaveText('2400');
    await page.screenshot({ path: testInfo.outputPath('workflow-query-results.png'), fullPage: true });
    // Swap the real presentations above one stable feature hook: no refetch,
    // lost attempt, SQL draft, dataset, result or exact review pin on rotation.
    const beforeResize = await worker.evaluate(() => (globalThis as any).calls.length);
    for (const [surface, orientation, width, height] of [
      ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
      ['tablet', 'portrait', 768, 1024], ['tablet', 'landscape', 1024, 768],
      ['desktop', 'portrait', 1000, 1500], ['desktop', 'landscape', 1500, 1000],
    ] as const) {
      await page.getByLabel('SQL query', { exact: true }).blur();
      await page.setViewportSize({ width, height });
      await expect(page.locator('main.workflow-runs')).toHaveAttribute('data-surface', surface);
      await expect(page.locator('main.workflow-runs')).toHaveAttribute('data-orientation', orientation);
      await expect(page.getByLabel('SQL query', { exact: true })).toHaveValue('SELECT count(*) AS n, sum(duration_ms) AS total_ms FROM spans');
      await expect(page.locator('.run-results tbody')).toHaveText('2400');
      await expect(page.getByRole('link', { name: 'Exact golden review' })).toHaveAttribute('href', /version=[a-f0-9]{40}&snapshot=a{40}/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`runs-${surface}-${orientation}.png`), fullPage: true });
    }
    expect(await worker.evaluate(() => (globalThis as any).calls.length)).toBe(beforeResize);
    // Actual Wasm engine must deny external I/O, not a fake SQL responder.
    await page.getByLabel('SQL query', { exact: true }).fill("SELECT * FROM read_csv('https://outside.example.test/private.csv')");
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/disabled|Permission|external|not allowed/i);
    expect(await worker.evaluate(() => (globalThis as any).calls.some((url: string) => url.includes('/actions/runs/99/')))).toBe(false);
    expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toContain('fixture-secret');
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('workflow-runs.png'), fullPage: true });
    await page.getByRole('button', { name: '← Back to runs' }).click();
    await page.getByLabel('Workspace', { exact: true }).selectOption('workspace-b');
    await page.getByRole('button', { name: 'Load workspace runs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fixture run 30', exact: true })).toBeVisible();
    expect(await page.locator('.run-list h2').allTextContents()).toEqual(['Fixture run 20', 'Fixture run 30']);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

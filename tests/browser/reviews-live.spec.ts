import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { boundedJSON, gitReadSchema, readGit } from '../../src/git-reads';
import type { GitTransport } from '../../hosted/workspaces';
import { reviewWriteSchema, type ReviewReceipt } from '../../src/review-protocol';
import { writeReview } from '../../src/review-writes';
import { pageChannel, replyChannel, hostedRelayRevision } from '../../src/bridge-channels';

// Explicit integration probe: credentials stay in this Node-side broker. The
// only writable packet must be clearly named as an automated transport test.
test('live pinned review reads, remote draft reopen, response and intake acknowledgement', async ({ page }) => {
  const requestId = process.env.REVIEW_LIVE_REQUEST;
  const local = process.env.REVIEW_LIVE_LOCAL === 'true';
  test.skip(!requestId || !local && !process.env.REVIEW_LIVE_APP, 'Requires an explicitly selected live verification packet.');
  test.setTimeout(180000);
  if (!/^task-z5a-transport-[A-Za-z0-9_-]+$/.test(requestId!)) throw new Error('Live writes are restricted to an automated transport verification packet.');
  const repository = process.env.REVIEW_LIVE_REPOSITORY ?? 'mickmister/workspace-storage';
  const workspace = process.env.REVIEW_LIVE_WORKSPACE ?? 'vk-46e5-vd-multi-instanc';
  const id = 'a6075abf-226e-4c88-977c-e11404e59f32';
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const cache = new Map<string, unknown>();
  async function api(path: string, limit: number, method = 'GET', body?: unknown): Promise<any> {
    if (path !== '/user' && !path.startsWith(`/repos/${repository}/git/`)) throw new Error('Unexpected live API path.');
    if (method === 'GET' && cache.has(path)) return cache.get(path);
    const response = await fetch(`https://api.github.com${path}`, {
      method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Live GitHub API returned HTTP ${response.status}.`);
    const value = await boundedJSON(response, limit);
    if (method === 'GET' && /\/git\/(commits|trees|blobs)\//.test(path)) cache.set(path, value);
    return value;
  }
  const user = await api('/user', 100000);
  const read: GitTransport = <T>(input: any) => readGit(gitReadSchema.parse(input), repository, (path, limit) => api(path, limit ?? 1024 * 1024)) as Promise<T>;
  const receipts: ReviewReceipt[] = [];
  await page.exposeFunction('__reviewLiveTransport', async (request: any) => {
    if (request.operation === 'discover') return { capabilities: ['gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'implicitWorkspaces', 'reviewWrite'] };
    if (request.operation === 'connections') return [{ id, name: 'Automated verification broker', appId: 1, user: { id: user.id, login: user.login }, installation: { id: 1, account: user.login } }];
    if (request.id !== id || request.repository !== repository || request.installationId !== 1) throw new Error('Unexpected live scope.');
    if (request.operation === 'reviewWrite') {
      const input = reviewWriteSchema.parse(request);
      if (JSON.parse(input.text).request.id !== requestId || input.workspace !== workspace) throw new Error('Writes outside the automated packet are forbidden.');
      const receipt = await writeReview(input, `github:${user.id}`, read, (path, method, body) => api(path, 1024 * 1024, method, body));
      receipts.push(receipt); return receipt;
    }
    return read(request);
  });
  await page.addInitScript(({ pageChannel, replyChannel, relayRevision }) => {
    window.addEventListener('message', async event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== pageChannel) return;
      const { requestId, request } = event.data;
      try {
        const result = await (window as any).__reviewLiveTransport(request);
        window.postMessage({ channel: replyChannel, version: 1, relayRevision, requestId, ok: true, result }, location.origin);
      } catch (cause) {
        window.postMessage({ channel: replyChannel, version: 1, relayRevision, requestId, ok: false, error: String(cause) }, location.origin);
      }
    });
  }, { pageChannel, replyChannel, relayRevision: hostedRelayRevision });
  let app = process.env.REVIEW_LIVE_APP!;
  if (local) {
    const shell = await readFile('hosted-dist/app/index.html', 'utf8');
    const path = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
    app = `https://mickmister.github.io${path}`;
    await page.route('https://mickmister.github.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = pathname.startsWith(path) ? pathname.slice(path.length) || 'index.html' : '';
      if (file !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf)$/.test(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: resolve('hosted-dist/app', file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const search = new URLSearchParams({ repository, workspace });
  await page.goto(`${app}#/reviews/${requestId}?${search}`);
  await expect(page.getByRole('heading', { name: 'Automated review transport verification', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: /^Comments ·/ })).toHaveCount(1);
  if (process.env.REVIEW_LIVE_ACK === 'true') {
    await expect(page.getByLabel('Submission receipts')).toContainText('Task notification acknowledged');
  } else if (await page.getByLabel('Submission receipts').getByText('Response saved; task notification pending', { exact: true }).count() === 0) {
    await page.getByText('I have reviewed this item', { exact: true }).click();
    await page.getByRole('button', { name: 'Save draft remotely' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved remotely' })).toBeVisible({ timeout: 90000 });
    await page.reload();
    await expect(page.getByLabel('I have reviewed this item')).toBeChecked({ timeout: 90000 });
    await page.getByRole('button', { name: 'Automated verification form', exact: true }).click();
    await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Automated transport verification; not a human review decision.');
    await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
    await page.getByRole('button', { name: 'Submit this form' }).click();
    await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending', { timeout: 90000 });
    expect(receipts.some(receipt => receipt.resource.includes('/drafts/'))).toBe(true);
    expect(receipts.some(receipt => receipt.resource.includes('/responses/'))).toBe(true);
  }
  if (process.env.REVIEW_LIVE_READER_REQUEST) {
    await page.goto(`${app}#/reviews/${process.env.REVIEW_LIVE_READER_REQUEST}?${search}`);
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click({ timeout: 90000 });
    await expect(page.getByRole('heading', { name: 'Document reading, comments and incremental review', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review experience feedback', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Focused review experience feedback', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ app, requestId, receipts, acknowledged: process.env.REVIEW_LIVE_ACK === 'true' }));
});

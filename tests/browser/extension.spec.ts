import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const form = { format: 'standard', id: 'next_steps', title: 'Choose the next step', goal: 'Resolve the approach', session_id: 'session-alpha', questions: [{ id: 'scope', type: 'choices', title: 'Investigation scope', choices: [{ id: 'unit', label: 'Unit tests', is_recommended_reason: 'Fastest feedback' }, { id: 'all', label: 'All tests' }], required: true }, { id: 'instructions', type: 'textarea', title: 'Instructions', required: true }] };
const snapshot = { kind: 'workflow', schema_version: 1, task_id: 'task-alpha', title: 'Investigate failing checks', session_id: 'session-alpha', status: 'running', updated_at: '2026-11-05T07:00:00Z', dashboard_url: 'https://runner.tailnet.ts.net/', run_url: 'https://github.com/owner/repo/actions/runs/42', formula: 'simple', beads: [{ id: 'bead-one', title: 'Inspect failures', status: 'closed' }, { id: 'bead-two', title: 'Explain fix', status: 'in_progress' }] };
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function comment(id: number, data: unknown) { return `<article id="issuecomment-${id}" class="timeline-comment"><div class="comment-body"><div class="highlight-source-json"><pre><code>${escape(JSON.stringify(data, null, 2))}</code></pre></div></div></article>`; }
function fixture() { return `<!doctype html><html data-color-mode="light"><head><title>Fixture PR</title></head><body><main><h1>PR conversation</h1>${comment(1, form)}${comment(2, snapshot)}<form id="new_comment"><textarea id="new_comment_field" name="comment[body]" aria-label="GitHub comment"></textarea><button type="submit">Comment</button></form></main><script>window.nativeSubmissions=0; document.querySelector('#new_comment').onsubmit=e=>{e.preventDefault();window.nativeSubmissions++}</script></body></html>`; }
let context: BrowserContext, page: Page, profile: string;
test.beforeEach(async () => {
  profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-test-'));
  const extension = resolve('dist');
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture() }));
  page = await context.newPage(); await page.goto('https://github.com/owner/repo/pull/7');
  await expect(page.getByRole('heading', { name: 'Choose the next step' })).toBeVisible();
});
test.afterEach(async () => { await context?.close(); await rm(profile, { recursive: true, force: true }); });

test('packaged extension renders forms, previews intent and preserves native drafts without auto submit', async () => {
  await page.getByRole('textbox', { name: 'GitHub comment' }).fill('My existing draft.');
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Explain the failing test.');
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  const preview = page.getByRole('textbox', { name: 'Generated comment preview' });
  await expect(preview).toHaveValue(/\/github-ultimate discuss/);
  await expect(preview).toHaveValue(/"allow_code_file_changes": false/);
  await expect(preview).toHaveValue(/"resume_session": true/);
  await page.getByRole('button', { name: 'Place in GitHub comment editor' }).click();
  await expect(page.getByRole('textbox', { name: 'GitHub comment' })).toHaveValue(/^My existing draft\.\n\n\/github-ultimate discuss/);
  expect(await page.evaluate(() => (window as unknown as { nativeSubmissions: number }).nativeSubmissions)).toBe(0);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  await expect(preview).toHaveValue(/\/github-ultimate approve/);
  await expect(preview).toHaveValue(/"allow_code_file_changes": true/);
});
test('restores drafts and notes after reload, validates required fields', async () => {
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Generated comment preview' })).toBeHidden();
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Keep context across runs.');
  await page.getByText('More info about Unit tests', { exact: true }).click();
  await page.getByRole('textbox', { name: 'More info about Unit tests', exact: true }).fill('Only the failed test.');
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Keep context across runs.');
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'More info about Unit tests', exact: true })).toHaveValue('Only the failed test.');
});
test('workspace shows saved run/bead details and private dashboard link', async () => {
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  const workspace = page.getByRole('complementary', { name: 'GitHub Ultimate PR workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText('1 / 2 beads complete')).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'Private dashboard' })).toHaveAttribute('href', 'https://runner.tailnet.ts.net/');
  await workspace.getByRole('button', { name: 'Runs & beads' }).click();
  await expect(workspace.getByRole('heading', { name: 'Saved workflow history' })).toBeVisible();
  await page.screenshot({ path: 'test-results/pr-workspace.png', fullPage: true });
});
test('SPA entry, edits, teardown and repeated mutations do not duplicate mounts', async () => {
  await page.evaluate(() => { history.pushState({}, '', '/owner/repo'); document.body.append(document.createElement('div')); });
  await expect(page.getByRole('button', { name: 'Open GitHub Ultimate workspace' })).toHaveCount(0);
  await page.evaluate(() => { history.pushState({}, '', '/owner/repo/pull/7'); document.body.append(document.createElement('div')); });
  await expect(page.getByRole('heading', { name: 'Choose the next step' })).toHaveCount(1);
  await page.evaluate(() => {
    const code = document.querySelector('#issuecomment-1 pre code')!;
    const value = JSON.parse(code.textContent!); value.title = 'Updated form'; code.textContent = JSON.stringify(value);
  });
  await expect(page.getByRole('heading', { name: 'Updated form', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Choose the next step' })).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(page.getByRole('heading', { name: 'Updated form', exact: true })).toHaveCount(1);
});
test('untrusted Markdown stays inert and invalid records preserve original code', async () => {
  await page.evaluate(({ html, comment: extra }) => {
    const data = JSON.parse(document.querySelector('#issuecomment-1 pre code')!.textContent!);
    data.questions[0].description = html;
    document.querySelector('#issuecomment-1 pre code')!.textContent = JSON.stringify(data);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', extra);
  }, { html: '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>[bad](javascript:alert(1))', comment: comment(3, { ...form, id: 'bad', workflow: 'untrusted.yml' }) });
  await expect(page.getByText(/could not render this record/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await expect(page.locator('#issuecomment-3 pre')).toBeVisible();
});

test('posted responses reconstruct answered state and can be loaded for editing', async () => {
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Persisted answer from another browser.');
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  const value = await page.getByRole('textbox', { name: 'Generated comment preview' }).inputValue();
  const record = JSON.parse(value.split('```github-response\n')[1].split('\n```')[0]);
  await page.evaluate(html => { document.querySelector('main')!.insertAdjacentHTML('beforeend', html); }, comment(3, record));
  await expect(page.getByRole('button', { name: 'Load saved answers to edit' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Local edit.');
  await page.getByRole('button', { name: 'Load saved answers to edit' }).click();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Persisted answer from another browser.');
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  await expect(page.getByRole('button', { name: /Answered · Choose the next step/ })).toBeVisible();
});

test('YAML discussion-only forms and exclusive choices work in dark narrow layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(html => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    const data = JSON.parse(document.querySelector('#issuecomment-1 pre code')!.textContent!);
    data.questions[0].choiceGroups = [{ id: 'one', mode: 'exactlyOne', choiceIds: ['unit', 'all'] }];
    document.querySelector('#issuecomment-1 pre code')!.textContent = JSON.stringify(data);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', html);
  }, `<article id="issuecomment-4"><div class="comment-body"><div class="highlight-source-github-task"><pre><code>---\nformat: standard\nid: quick_question\ntitle: Quick follow-up\nallowCodeFileChanges: false\nquestions:\n  - id: ask\n    type: textarea\n    title: Ask a question\n---\nKeep this in discussion.</code></pre></div></div></article>`);
  await expect(page.getByRole('heading', { name: 'Quick follow-up' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await page.getByRole('checkbox', { name: 'All tests' }).check();
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).not.toBeChecked();
  // Only the first form has an approval action; the discussion-only form cannot approve.
  await expect(page.getByRole('button', { name: 'Approved for next steps', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  const workspace = page.getByRole('complementary', { name: 'GitHub Ultimate PR workspace' });
  await expect(workspace).toBeVisible();
  expect((await workspace.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile-dark-workspace.png', fullPage: true });
});

test('overview selects newest task snapshot by instant and run history retains previous attempts', async () => {
  const newer = { ...snapshot, updated_at: '2026-11-05T05:30:00-02:00', title: 'Completed investigation', status: 'done', attempt_id: 'attempt-two' };
  await page.evaluate(html => document.querySelector('main')!.insertAdjacentHTML('beforeend', html), comment(3, newer));
  await expect(page.getByRole('heading', { name: 'Completed investigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  const workspace = page.getByRole('complementary', { name: 'GitHub Ultimate PR workspace' });
  await expect(workspace.getByRole('heading', { name: 'Completed investigation' })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Investigate failing checks' })).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Runs & beads' }).click();
  await expect(workspace.getByRole('heading', { name: 'Investigate failing checks' })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Completed investigation' })).toBeVisible();
});

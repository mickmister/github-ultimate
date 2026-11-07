import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const form = { format: 'standard', id: 'next_steps', title: 'Choose the next step', goal: 'Resolve the approach', session_id: 'session-alpha', questions: [{ id: 'scope', type: 'choices', title: 'Investigation scope', choices: [{ id: 'unit', label: 'Unit tests', is_recommended_reason: 'Fastest feedback' }, { id: 'all', label: 'All tests' }], required: true }, { id: 'instructions', type: 'textarea', title: 'Instructions', required: true }] };
const snapshot = { kind: 'workflow', schema_version: 1, task_id: 'task-alpha', title: 'Investigate failing checks', session_id: 'session-alpha', status: 'running', updated_at: '2026-11-05T07:00:00Z', dashboard_url: 'https://runner.tailnet.ts.net/', run_url: 'https://github.com/owner/repo/actions/runs/42', formula: 'simple', beads: [{ id: 'bead-one', title: 'Inspect failures', status: 'closed' }, { id: 'bead-two', title: 'Explain fix', status: 'in_progress' }] };
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function comment(id: number, data: unknown) { return `<article id="issuecomment-${id}" class="timeline-comment"><div class="comment-body"><div class="highlight-source-json"><pre><code>${escape(JSON.stringify(data, null, 2))}</code></pre></div></div></article>`; }
function fixture() { return `<!doctype html><html data-color-mode="light"><head><title>Fixture PR</title><script>window.shortcutHits=[]; for(const type of ['keydown','keypress','keyup']) window.addEventListener(type,e=>{if(e.key==='m')window.shortcutHits.push(type)},true); document.addEventListener('keydown',e=>{if(e.key==='m')window.shortcutHits.push('document')},true);</script></head><body><main><h1>PR conversation</h1>${comment(1, form)}${comment(2, snapshot)}<form id="new_comment"><textarea id="new_comment_field" name="comment[body]" aria-label="GitHub comment"></textarea><button type="submit">Comment</button></form></main><script>window.nativeSubmissions=0; document.querySelector('#new_comment').onsubmit=e=>{e.preventDefault();window.nativeSubmissions++}</script></body></html>`; }
const goInstructions = (page: Page) => page.getByRole('button', { name: '2. Instructions', exact: true }).click();
const goScope = (page: Page) => page.getByRole('button', { name: '1. Investigation scope', exact: true }).click();
const goReview = (page: Page) => page.getByRole('button', { name: 'Review answers', exact: true }).first().click();
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
  await goInstructions(page);
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Explain the failing test.');
  await goReview(page);
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
test('restores drafts, wizard position and note icons; requested answers may be omitted', async () => {
  await goReview(page);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Generated comment preview' })).toHaveValue(/"omitted_questions"/);
  await goScope(page);
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  const note = page.getByRole('button', { name: 'Add note about Unit tests', exact: true });
  await expect(note).toHaveText('');
  await note.click();
  await page.getByRole('textbox', { name: 'Add note about Unit tests', exact: true }).fill('Only the failed test.');
  await goInstructions(page);
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Keep context across runs.');
  // Flush before reload; no save-status UI is required to recover the draft.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForTimeout(300);
  await expect(page.getByText(/Saving draft|Draft saved|Restored saved draft/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Keep context across runs.');
  await goScope(page);
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Add note about Unit tests', exact: true })).toHaveValue('Only the failed test.');
});

test('Other and multiple selections survive zen, review and posted history', async () => {
  await page.evaluate(() => {
    const code = document.querySelector('#issuecomment-1 pre code')!;
    const data = JSON.parse(code.textContent!);
    data.questions[0].choiceGroups = [{ id: 'one', mode: 'exactlyOne', choiceIds: ['unit', 'all'] }];
    code.textContent = JSON.stringify(data);
  });
  await expect(page.getByText('The author suggests one option; you may select several or choose Other.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Unit tests', exact: true }).check();
  await page.getByRole('checkbox', { name: 'All tests', exact: true }).check();
  const other = page.getByRole('checkbox', { name: 'Other', exact: true });
  await expect(other).toHaveCount(1); await other.check();
  await page.getByRole('textbox', { name: 'Add note about Other', exact: true }).fill('A combined approach.');
  await page.getByRole('button', { name: 'Open in zen', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Unit tests', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  await expect(other).toBeChecked();
  await goReview(page);
  await expect(page.locator('.answer-review')).toContainText('Unit tests, All tests, Other');
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  const value = await page.getByRole('textbox', { name: 'Generated comment preview' }).inputValue();
  const record = JSON.parse(value.split('```github-response\n')[1].split('\n```')[0]);
  expect(record.answers.scope).toEqual({ unit: true, all: true, other: true });
  expect(record.answers.scope_other_more_info).toBe('A combined approach.');
  await page.evaluate(html => document.querySelector('main')!.insertAdjacentHTML('beforeend', html), comment(3, record));
  await page.getByRole('button', { name: 'View submitted answers' }).click();
  await expect(page.locator('.saved-answers')).toContainText('A combined approach.');
  await expect(page.locator('.saved-answers')).toContainText('Unit tests, All tests, Other');
});

test('sticky pending prompt stays out of response preview and native submission without claiming success', async () => {
  await goReview(page);
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  await page.getByRole('button', { name: 'Place in GitHub comment editor', exact: true }).click();
  // Put the source well offscreen, then move focus from editor to submission.
  await page.evaluate(() => {
    const spacer = document.createElement('div'); spacer.style.height = '3000px';
    document.querySelector('#new_comment')!.before(spacer);
    document.querySelector('#new_comment')!.scrollIntoView();
  });
  await page.getByRole('button', { name: 'Comment', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Go to form', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'View submitted answers' })).toHaveCount(0);
  // Cancel composition: close preview and clear the draft; pending is discoverable again.
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub comment', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'GitHub comment', exact: true }).evaluate(node => (node as HTMLTextAreaElement).blur());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('button', { name: 'Go to form', exact: true })).toBeVisible();
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

test('posted responses collapse into immutable summaries and allow a separate new response', async () => {
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await goInstructions(page);
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Persisted answer from another browser.');
  await goReview(page);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  const value = await page.getByRole('textbox', { name: 'Generated comment preview' }).inputValue();
  const record = JSON.parse(value.split('```github-response\n')[1].split('\n```')[0]);
  await page.evaluate(html => { document.querySelector('main')!.insertAdjacentHTML('beforeend', html); }, comment(3, record));
  await expect(page.getByRole('button', { name: 'View submitted answers' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeHidden();
  await page.getByRole('button', { name: 'View submitted answers' }).click();
  await expect(page.locator('.saved-answers').getByText('Persisted answer from another browser.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  await expect(page.getByRole('button', { name: /Submitted · Choose the next step/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await context.unroute('https://github.com/**');
  await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture().replace('</main>', `${comment(3, record)}</main>`) }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'View submitted answers' })).toBeVisible();
  await expect(page.locator('.saved-answers')).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeHidden();
  await page.getByRole('button', { name: 'Submit another response' }).click();
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).not.toBeChecked();
  await goReview(page);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  const next = JSON.parse((await page.getByRole('textbox', { name: 'Generated comment preview' }).inputValue()).split('```github-response\n')[1].split('\n```')[0]);
  expect(next.response_id).not.toBe(record.response_id);
  expect(await page.locator('#issuecomment-3 pre code').textContent()).toContain(record.response_id);
  await page.evaluate(() => {
    const code = document.querySelector('#issuecomment-1 pre code')!;
    const revised = JSON.parse(code.textContent!); revised.description = 'A new source revision.'; code.textContent = JSON.stringify(revised);
  });
  await expect(page.getByRole('button', { name: 'View submitted answers' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).not.toBeChecked();
});

test('YAML discussion-only forms permit multiple choices in authored single-choice groups', async () => {
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
  await expect(page.getByRole('checkbox', { name: 'Unit tests' })).toBeChecked();
  await goReview(page);
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

test('typing m is isolated from capture-phase GitHub shortcuts without breaking native typing', async () => {
  await goInstructions(page);
  const input = page.getByRole('textbox', { name: 'Instructions', exact: true });
  await input.click(); await page.keyboard.type('m markdown');
  await expect(input).toHaveValue('m markdown');
  expect(await page.evaluate(() => (window as unknown as { shortcutHits: string[] }).shortcutHits)).toEqual([]);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.type('m');
  await expect(page.getByText('Question 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'GitHub comment' }).click(); await page.keyboard.type('m');
  expect((await page.evaluate(() => (window as unknown as { shortcutHits: string[] }).shortcutHits)).length).toBeGreaterThan(0);
});

test('zen shares wizard state, contains focus, closes with Escape and preserves answers', async () => {
  await page.getByRole('checkbox', { name: 'Unit tests' }).check();
  await goInstructions(page);
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Same draft in zen.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open in zen', exact: true }).click();
  const zen = page.getByRole('dialog', { name: 'Choose the next step' });
  await expect(zen).toBeVisible();
  await expect(zen.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Same draft in zen.');
  await expect(zen.getByText('Question 2 of 2', { exact: true })).toBeVisible();
  await zen.getByRole('textbox', { name: 'Instructions', exact: true }).click(); await page.keyboard.type('m');
  expect(await page.evaluate(() => (window as unknown as { shortcutHits: string[] }).shortcutHits)).toEqual([]);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await page.locator('#issuecomment-1 .github-ultimate-record').evaluate(host => Boolean(host.shadowRoot!.activeElement?.closest('dialog')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(zen).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Same draft in zen.m');
  await expect(page.getByRole('button', { name: 'Open in zen', exact: true })).toBeFocused();
});

test('offscreen pending form has a sticky zen entry point without automatic opening', async () => {
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '1800px'; document.querySelector('main')!.prepend(spacer); window.scrollTo(0, 0); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sticky = page.getByRole('region', { name: 'Pending forms' });
  await expect(sticky.getByRole('button', { name: 'Go to form', exact: true })).toBeVisible();
  await sticky.getByRole('button', { name: 'Go to form', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose the next step' })).toBeVisible();
  await expect(sticky).toBeHidden();
});

test('native-readable form wrappers are replaced once and restored on route exit', async () => {
  const wrapped = { ...form, id: 'native_form', title: 'Native readable form' };
  await page.evaluate(({ data, raw }) => {
    const article = document.createElement('article'); article.id = 'issuecomment-4'; article.innerHTML = `<div class="comment-body"><details open><summary>Form: Native readable form</summary><p>Readable questions for users without the extension.</p><pre><code>${raw}</code></pre></details></div>`; document.querySelector('main')!.append(article);
  }, { data: wrapped, raw: escape(JSON.stringify(wrapped)) });
  await expect(page.getByRole('heading', { name: 'Native readable form', exact: true })).toBeVisible();
  await expect(page.locator('#issuecomment-4 details').first()).toBeHidden();
  expect(await page.locator('#issuecomment-4 .github-ultimate-record').evaluate(host => Boolean(host.closest('details')))).toBe(false);
  await page.evaluate(() => { history.pushState({}, '', '/owner/repo'); document.body.append(document.createElement('div')); });
  await expect(page.locator('#issuecomment-4 details').first()).toBeVisible();
  await expect(page.getByText('Readable questions for users without the extension.')).toBeVisible();
});

test('multiple pending forms can be selected and zen is cleaned up on SPA exit', async () => {
  await page.evaluate(html => {
    document.querySelector('main')!.insertAdjacentHTML('beforeend', html);
    const spacer = document.createElement('div'); spacer.style.height = '1800px'; document.querySelector('main')!.prepend(spacer); window.scrollTo(0, 0);
  }, comment(4, { ...form, id: 'second_form', title: 'Choose the second approach' }));
  const sticky = page.getByRole('region', { name: 'Pending forms' });
  await expect(sticky.getByText('2 forms need input', { exact: true })).toBeVisible();
  await sticky.getByRole('combobox', { name: 'Choose pending form' }).selectOption({ label: 'Choose the second approach' });
  await sticky.getByRole('button', { name: 'Go to form', exact: true }).click();
  const zen = page.getByRole('dialog', { name: 'Choose the second approach' });
  await expect(zen).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Choose the next step' })).toBeHidden();
  await zen.getByRole('checkbox', { name: 'Unit tests' }).check();
  await page.evaluate(() => { history.pushState({}, '', '/owner/repo'); document.body.append(document.createElement('div')); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.github-ultimate-record')).toHaveCount(0);
  await expect(page.locator('#issuecomment-4 pre')).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';

async function finishForm(page: Page) {
  while (await page.getByRole('button', { name: 'Next question', exact: true }).count()) await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
}

function pinnedReviewURL() {
  const query = new URLSearchParams({ repository: 'example/storage', workspace: 'reader-workspace', version: 'e'.repeat(40), snapshot: '1'.repeat(40) });
  return `/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true#/reviews/reader-01?${query}`;
}

test('review inbox does not prefetch member content; opening a detail prefetches all documents, forms and baselines', async ({ page }) => {
  const reads: string[] = [];
  await page.route('**/__review-fixture', async route => {
    const resource = route.request().headers()['x-review-resource'];
    if (resource) reads.push(JSON.parse(resource).version);
    await route.fulfill({ json: { artifacts: [], revision: 1 } });
  });
  await page.goto('/iframe.html?id=web-app-reviews--inbox&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('region', { name: 'Review inbox', exact: true })).toBeVisible({ timeout: 30000 });
  const detail = page.getByRole('link', { name: 'Reader follow-up', exact: true });
  await expect(detail).toBeVisible();
  expect(reads).toEqual([]);
  await detail.click();
  await expect(page.getByText('All review documents and forms downloaded.', { exact: true })).toBeVisible();
  expect(reads.sort()).toEqual(['a', 'b', 'c', 'd'].map(letter => letter.repeat(40)));
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.locator('.review-form h3')).toHaveText('Reader decisions');
  expect(reads).toHaveLength(4);
});

for (const fullReview of [false, true]) {
  test(`choice notes and multiple suggested-single selections survive remote drafts and ${fullReview ? 'full-review' : 'form-only'} submission`, async ({ page }) => {
    let state: any = { artifacts: [], revision: 1 };
    await page.route('**/__review-fixture', async route => {
      if (route.request().method() === 'POST') state = route.request().postDataJSON();
      await route.fulfill({ json: state });
    });
    const url = '/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true';
    const member = fullReview ? 'experience' : 'reader';
    const formButton = fullReview ? 'Review experience' : 'Reader decisions';
    await page.goto(url);
    if (fullReview) {
      await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
      await page.getByText('Keep this approach', { exact: true }).click();
    }
    await page.getByRole('button', { name: formButton, exact: true }).click();
    const keep = page.locator('[data-ui="review-choice"]').filter({ has: page.getByRole('checkbox', { name: 'Keep this approach', exact: true }) });
    await expect(keep.getByRole('heading', { name: 'Pros', exact: true })).toBeVisible();
    await expect(keep.getByRole('heading', { name: 'Cons', exact: true })).toBeVisible();
    await expect(keep.getByText('Retains the verified behavior', { exact: true })).toBeVisible();
    const revise = page.locator('[data-ui="review-choice"]').filter({ has: page.getByRole('checkbox', { name: 'Revise this approach', exact: true }) });
    await expect(revise.getByRole('heading', { name: 'Pros', exact: true })).toHaveCount(0);
    await page.getByText('Add note about Keep this approach', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true }).fill('Keep the tested behavior.');
    // Notes on an unselected alternative must not silently select it.
    await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).not.toBeChecked();
    await page.getByText('Keep this approach', { exact: true }).click();
    await page.getByText('Revise this approach', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
    await page.getByText('Add note about Revise this approach', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes for Revise this approach', exact: true }).fill('Improve the navigation too.');
    await page.getByText('Add note about Other', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes for Other', exact: true }).fill('Consider a hybrid.');
    await page.getByRole('textbox', { name: 'Additional context for Next steps', exact: true }).fill('Combine these options.');
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true })).toHaveValue('Keep the tested behavior.');
    await page.getByRole('button', { name: 'Save draft remotely', exact: true }).click();
    await expect.poll(() => state.artifacts.filter((item: any) => item.value.kind === 'review-draft').length).toBe(1);
    // Remove browser recovery so this exercises actual remote draft hydration.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(url);
    await page.getByRole('button', { name: formButton, exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Revise this approach', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Other', exact: true })).not.toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Notes for Revise this approach', exact: true })).toHaveValue('Improve the navigation too.');
    await expect(page.getByRole('textbox', { name: 'Notes for Other', exact: true })).toHaveValue('Consider a hybrid.');
    await finishForm(page);
    await page.getByRole('button', { name: fullReview ? 'Submit full review' : 'Submit just this form', exact: true }).click();
    await expect.poll(() => state.artifacts.filter((item: any) => item.value.kind === 'review-response').length).toBe(1);
    const response = state.artifacts.find((item: any) => item.value.kind === 'review-response').value;
    expect(response.forms.find((form: any) => form.member_id === member).answers).toMatchObject({
      decision: { keep: true, revise: true }, decision_keep_more_info: 'Keep the tested behavior.',
      decision_revise_more_info: 'Improve the navigation too.', decision_other_more_info: 'Consider a hybrid.',
      decision_more_info: 'Combine these options.',
    });
  });
}

test('next form retains answers without submitting, and final form submits the full review with locally recovered comments', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  const url = '/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true';
  await page.goto(url);
  await page.getByText('The full target document is pinned to this packet.').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await composer.getByLabel('Your comment').fill('Recover this document comment without a remote draft.');
  await composer.getByRole('button', { name: 'Add to queue', exact: true }).click();
  expect(state.artifacts).toHaveLength(0);
  // A new tab has no answer/session recovery; comments must come from local storage.
  const fresh = await page.context().newPage();
  await fresh.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await fresh.goto(url);
  await expect(fresh.getByRole('button', { name: 'Comments · 1', exact: true })).toBeVisible();
  await fresh.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  const queue = fresh.getByRole('dialog', { name: 'Queued comments', exact: true });
  await queue.getByLabel('Comment 1', { exact: true }).fill('Edited locally before submitting.');
  await queue.getByRole('button', { name: 'Close comments', exact: true }).click();
  await fresh.reload();
  await fresh.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Edited locally before submitting.');
  await queue.getByRole('button', { name: 'Close comments', exact: true }).click();
  await fresh.getByRole('link', { name: 'Review inbox', exact: true }).click();
  await fresh.getByRole('link', { name: 'Independent reader review' }).click();
  await expect(fresh.getByRole('button', { name: 'Comments · 0', exact: true })).toBeVisible();
  await fresh.goto(url);
  await fresh.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await fresh.getByText('Keep this approach', { exact: true }).click();
  await finishForm(fresh);
  await expect(fresh.getByRole('button', { name: 'Submit full review', exact: true })).toHaveCount(0);
  await fresh.getByRole('button', { name: 'Go to next form', exact: true }).click();
  expect(state.artifacts).toHaveLength(0);
  await expect(fresh.locator('.review-form h3')).toHaveText('Review experience feedback');
  await fresh.getByText('Revise this approach', { exact: true }).click();
  await finishForm(fresh);
  await expect(fresh.getByRole('button', { name: 'Go to next form', exact: true })).toHaveCount(0);
  await expect(fresh.getByRole('button', { name: 'Submit just this form', exact: true })).toBeEnabled();
  await fresh.getByRole('button', { name: 'Submit full review', exact: true }).click();
  await expect(fresh.getByRole('status')).toContainText('Response saved remotely');
  const response = state.artifacts.find((item: any) => item.value.kind === 'review-response').value;
  expect(response.forms).toHaveLength(2);
  expect(response.comments).toEqual([expect.objectContaining({ member_id: 'plan', text: 'Edited locally before submitting.' })]);
  await fresh.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await queue.getByRole('button', { name: 'Remove comment 1', exact: true }).click();
  await queue.getByRole('button', { name: 'Close comments', exact: true }).click();
  await fresh.reload();
  await expect(fresh.getByRole('button', { name: 'Comments · 0', exact: true })).toBeVisible();
  await fresh.close();
});

test('inbox setup discovers repository and workspace without a hidden required field', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--inbox&viewMode=story#/reviews');
  await expect(page.getByRole('combobox', {name:'Storage repository',exact:true})).toHaveValue('example/storage');
  await expect(page.getByRole('combobox', {name:'Workspace',exact:true})).toHaveValue('reader-workspace');
  await page.getByRole('button', {name:'Open review inbox',exact:true}).click();
  await expect(page.getByRole('region', {name:'Review inbox',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox', {name:'Workspace',exact:true})).toHaveValue('reader-workspace');
  await expect(page.getByRole('checkbox', {name:'Only waiting for my response',exact:true})).toBeChecked();
  await expect(page.getByRole('link', {name:'Reader follow-up',exact:true})).toBeVisible();
});

test('process submission explains correlated workflow progress and exposes the next checkpoint without resubmitting',async({page})=>{
  let state:any={artifacts:[],revision:1,workflow:{state:'running',checked_at:'2026-11-17T00:00:00Z',dispatch:{state:'dispatched'},run:{id:1,url:'https://github.com/example/source/actions/runs/1',status:'in_progress',conclusion:null}}};
  let saves=0;
  await page.route('**/__review-fixture',async route=>{
    if(route.request().method()==='POST'){saves++;state=route.request().postDataJSON();}
    await route.fulfill({json:state});
  });
  await page.goto('/iframe.html?id=web-app-reviews--process-context&viewMode=story&remoteFixture=true');
  await page.getByRole('button',{name:'Reader decisions',exact:true}).click();
  await page.getByRole('button',{name:'Zen mode',exact:true}).click();
  await page.getByText('Keep this approach',{exact:true}).click();
  await finishForm(page);
  await page.getByRole('button',{name:'Submit just this form',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel=page.getByRole('region',{name:'Workflow after submission',exact:true});
  await expect(panel.getByText('Workflow is running',{exact:true})).toBeVisible();
  await expect(panel.getByRole('link',{name:'Open the correlated workflow run',exact:true})).toHaveAttribute('href','https://github.com/example/source/actions/runs/1');
  state.nextCheckpoint=true;state.workflow={...state.workflow,state:'completed',run:{...state.workflow.run,status:'completed',conclusion:'success'}};
  await panel.getByRole('button',{name:'Refresh workflow progress',exact:true}).click();
  await expect(panel.getByRole('link',{name:'Open next checkpoint: Next Goals checkpoint',exact:true})).toBeVisible();
  state.nextCheckpoint=false;
  await panel.getByRole('button',{name:'Refresh workflow progress',exact:true}).click();
  await expect(panel.getByRole('link',{name:'Open next checkpoint: Next Goals checkpoint',exact:true})).toHaveCount(0);
  state.nextCheckpoint=true;state.workflowError=true;
  await panel.getByRole('button',{name:'Refresh workflow progress',exact:true}).click();
  await expect(panel.getByRole('link',{name:'Open next checkpoint: Next Goals checkpoint',exact:true})).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Actions unavailable');
  expect(saves).toBe(1);
  await expect(panel.getByText('You do not need to resubmit this response to check progress.',{exact:false})).toBeVisible();
  await panel.getByText('Agent transcripts and diagnostics',{exact:true}).click();
  await expect(panel.getByRole('link',{name:'Open private S3 object browser',exact:true})).toHaveAttribute('href',/\/s3\.html$/);
});

test('pinned deep links render and preload before targeted saved-state loading, then restore the remote draft', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  let holdListing = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: { operation: string; request?: string; resource?: string }[] = [];
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    const headers = route.request().headers();
    const operation = headers['x-review-operation'];
    if (holdListing) {
      calls.push({ operation, request: headers['x-review-request'], resource: headers['x-review-resource'] });
      if (operation === 'list') await gate;
    }
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Restore this draft after the fast pinned preview.');
  await page.getByRole('button', { name: 'Save draft remotely', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved remotely');
  state.revision = 2;
  holdListing = true;
  await page.goto(pinnedReviewURL());
  await expect(page.getByRole('heading', { name: 'Reader follow-up', exact: true })).toBeVisible();
  const preview = page.getByRole('region', { name: 'Pinned review preview', exact: true });
  await expect(preview.getByText('The full target document is pinned to this packet.')).toBeVisible();
  await expect.poll(() => calls.filter(item => item.resource).length).toBe(4);
  expect(calls[0]).toMatchObject({ operation: 'open', request: 'reader-01' });
  expect(calls.filter(item => item.operation === 'list')).toEqual([{ operation: 'list', request: 'reader-01', resource: undefined }]);
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit review feedback', exact: true })).toHaveCount(0);
  release();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Restore this draft after the fast pinned preview.');
  await expect(page.getByText('Updated packet available.')).toBeVisible();
  await expect(page.getByText('All review documents and forms downloaded.', { exact: true })).toBeVisible();
  expect(calls.filter(item => item.resource)).toHaveLength(4);
});

test('pinned request failure does not fall back to listing the inbox', async ({ page }) => {
  const operations: string[] = [];
  await page.route('**/__review-fixture', async route => {
    const operation = route.request().headers()['x-review-operation']; operations.push(operation);
    await route.fulfill({ status: 503, body: 'Exact request unavailable' });
  });
  await page.goto(pinnedReviewURL());
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 });
  expect(operations).toEqual(['open']);
  await expect(page.getByRole('region', { name: 'Focused review session', exact: true })).toHaveCount(0);
});

test('a background saved-state failure retains the exact preview and retries without redownloading it', async ({ page }) => {
  let failListing = true;
  const operations: string[] = [];
  let reads = 0;
  await page.route('**/__review-fixture', async route => {
    const headers = route.request().headers();
    operations.push(headers['x-review-operation']);
    if (headers['x-review-resource']) reads++;
    if (failListing && headers['x-review-operation'] === 'list') return route.fulfill({ status: 503, body: 'Saved state temporarily unavailable' });
    await route.fulfill({ json: { artifacts: [], revision: 1 } });
  });
  await page.goto(pinnedReviewURL());
  await expect(page.getByRole('region', { name: 'Pinned review preview', exact: true })).toBeVisible();
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
  await expect.poll(() => reads).toBe(4);
  failListing = false;
  await page.getByRole('button', { name: 'Retry loading saved review state', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Focused review session', exact: true })).toBeVisible();
  expect(operations.filter(operation => operation === 'open')).toHaveLength(1);
  expect(operations.filter(operation => operation === 'list')).toHaveLength(2);
  expect(reads).toBe(4);
});

test('opening a review downloads every member and baseline before navigation, then switches without more reads', async ({ page }) => {
  const reads: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blockNewReads = false;
  await page.route('**/__review-fixture', async route => {
    const pin = route.request().headers()['x-review-resource'];
    if (pin) {
      reads.push(JSON.parse(pin).version);
      if (blockNewReads) return route.abort();
      await gate;
    }
    await route.fulfill({ json: { artifacts: [], revision: 1 } });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect.poll(() => reads.length, { timeout: 30000 }).toBe(4);
  expect(new Set(reads)).toEqual(new Set(['a', 'b', 'c', 'd'].map(letter => letter.repeat(40))));
  release();
  await expect(page.getByText('All review documents and forms downloaded.', { exact: true })).toBeVisible();
  blockNewReads = true;
  for (let pass = 0; pass < 2; pass++) {
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    await expect(page.locator('.review-form h3')).toHaveText('Reader decisions');
    await expect(page.getByText(/^Loading Reader decisions/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Review experience', exact: true }).click();
    await expect(page.locator('.review-form h3')).toHaveText('Review experience feedback');
    await page.getByRole('button', { name: 'Reader plan', exact: true }).click();
    await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    await expect(page.getByText('The baseline had browser-only drafts.')).toBeVisible();
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await expect(page.locator('[data-change=added]')).toContainText('Remote drafts survive reopening.');
  }
  expect(reads).toHaveLength(4);
});

test('a failed preload leaves other items usable and can be retried independently', async ({ page }) => {
  const reads: string[] = [];
  let failBaseline = true;
  await page.route('**/__review-fixture', async route => {
    const header = route.request().headers()['x-review-resource'];
    if (header) {
      const pin = JSON.parse(header); reads.push(pin.version);
      if (failBaseline && pin.version === 'b'.repeat(40)) return route.fulfill({ status: 503, body: 'Unavailable' });
    }
    await route.fulfill({ json: { artifacts: [], revision: 1 } });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('button', { name: 'Retry unavailable review contents', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.locator('.review-form h3')).toHaveText('Reader decisions');
  await page.getByRole('button', { name: 'Reader plan', exact: true }).click();
  await page.getByRole('button', { name: 'Baseline', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pinned baseline unavailable');
  failBaseline = false;
  await page.getByRole('button', { name: 'Retry unavailable review contents', exact: true }).click();
  await expect(page.getByText('All review documents and forms downloaded.', { exact: true })).toBeVisible();
  await expect(page.getByText('The baseline had browser-only drafts.')).toBeVisible();
  expect(reads.filter(version => version === 'b'.repeat(40))).toHaveLength(2);
  for (const letter of ['a', 'c', 'd']) expect(reads.filter(version => version === letter.repeat(40))).toHaveLength(1);
});

for (const width of [1920, 1280, 390]) {
  test(`review sidebar can be hidden without losing document mode or form answers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    const originalWidth = (await page.locator('.review-content').boundingBox())!.width;
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    const show = page.getByRole('button', { name: 'Show sidebar', exact: true });
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('complementary', { name: 'Review items', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Baseline', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const layout = (await page.locator('.review-layout').boundingBox())!;
    const content = (await page.locator('.review-content').boundingBox())!;
    expect(content.x).toBeCloseTo(layout.x);
    expect(content.width).toBeCloseTo(layout.width);
    if (width === 1280) expect(content.width).toBeGreaterThan(originalWidth + 200);
    await show.click();
    await expect(page.getByRole('button', { name: 'Hide sidebar', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    await page.getByText('Keep this approach', { exact: true }).click();
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
    await show.click();
    await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
  });

  test(`document zen mode keeps comparison, comments and remote drafts usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let state: any = { artifacts: [], revision: 1 };
    await page.route('**/__review-fixture', async route => {
      if (route.request().method() === 'POST') state = route.request().postDataJSON();
      await route.fulfill({ json: state });
    });
    await page.goto('/iframe.html?id=web-app-reviews--rich-changes&viewMode=story&remoteFixture=true');
    const shell = (await page.locator('.review-workspace').boundingBox())!;
    const padding = await page.locator('.review-workspace').evaluate(node => getComputedStyle(node).paddingLeft);
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    const zen = page.getByRole('dialog', { name: 'Reader plan — Zen mode', exact: true });
    await expect(zen.getByRole('heading', { name: 'Reader plan', level: 2, exact: true })).toBeFocused();
    expect(await zen.boundingBox()).toMatchObject({ x: 0, y: 0, width, height: 844 });
    const reading = zen.locator('.review-zen-document-content');
    expect((await reading.boundingBox())!.x).toBeCloseTo(shell.x);
    expect((await reading.boundingBox())!.width).toBeCloseTo(shell.width);
    expect(await reading.evaluate(node => getComputedStyle(node).paddingLeft)).toBe(padding);
    if (width === 1920) expect(shell.x).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(page.getByRole('link', { name: 'Review inbox', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toHaveCount(0);
    await expect(zen.getByRole('button', { name: 'Changes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(zen.locator('[data-change=added] strong')).toHaveText('remote drafts');
    await zen.getByRole('button', { name: 'Baseline', exact: true }).click();
    await expect(zen.locator('.markdown-preview strong')).toHaveText('local drafts');
    await zen.getByRole('button', { name: 'Full document', exact: true }).click();
    await zen.getByText('I have reviewed this item', { exact: true }).click();
    const selection = zen.locator('.markdown-preview strong');
    const openMenu = async () => {
      await selection.evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
      });
      if (width === 390) await zen.getByRole('button', { name: 'Comment on Reader plan', exact: true }).click();
      else await selection.click({ button: 'right' });
    };
    await openMenu();
    await expect(zen.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(zen.getByRole('menu')).toHaveCount(0);
    await expect(zen).toBeVisible();
    await openMenu();
    await zen.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
    const composer = zen.getByRole('dialog', { name: 'Comment on Content', exact: true });
    await expect(composer.locator('blockquote')).toHaveText('remote drafts');
    await composer.getByLabel('Your comment').fill('Keep this readable in document zen mode.');
    await composer.getByRole('button', { name: 'Add to queue', exact: true }).click();
    await zen.getByRole('button', { name: 'Comments · 1', exact: true }).click();
    const queue = zen.getByRole('dialog', { name: 'Queued comments', exact: true });
    await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Keep this readable in document zen mode.');
    await page.keyboard.press('Escape');
    await expect(queue).toHaveCount(0);
    await expect(zen).toBeVisible();
    await zen.getByRole('button', { name: 'Save draft remotely', exact: true }).click();
    await expect(zen.getByRole('status')).toContainText('Draft saved remotely');
    const draft = state.artifacts.find((item: any) => item.value.kind === 'review-draft').value;
    expect(draft.progress).toContain('plan');
    expect(draft.comments[0]).toMatchObject({ member_id: 'plan', text: 'Keep this readable in document zen mode.', selection: { text: 'remote drafts', representation: 'rendered-markdown' } });
    await zen.getByRole('button', { name: 'Changes', exact: true }).click();
    await zen.evaluate(node => { node.scrollTop = node.scrollHeight; });
    const back = zen.getByRole('button', { name: '← Back', exact: true });
    expect((await back.boundingBox())!.y).toBeLessThan(30);
    expect(await zen.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await back.click();
    await expect(zen).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zen mode', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Changes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: 'I have reviewed this item', exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(zen).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zen mode', exact: true })).toBeFocused();
  });
}

test('source document comparisons also work in zen mode', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--source-changes&viewMode=story');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
  const zen = page.getByRole('dialog', { name: 'Reader plan — Zen mode', exact: true });
  await expect(zen.locator('.monaco-diff-editor')).toBeVisible();
  await zen.getByRole('button', { name: 'Full document', exact: true }).click();
  await expect(zen.locator('[data-editor-ready=true]')).toBeVisible();
  await zen.getByRole('button', { name: '← Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zen mode', exact: true })).toBeFocused();
});

test('performance capture is available from UI and console and exports local OTLP JSON', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await page.getByText('Performance diagnostics', { exact: true }).click();
  await page.getByRole('button', { name: 'Start performance capture', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates and receipts', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reviewPerf.summary().some(item => item.operation === 'reviews.load'))).toBe(true);
  await page.getByRole('button', { name: 'Stop performance capture', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export performance JSON', exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe('review-performance.otel.json');
  const exported = await page.evaluate(() => window.reviewPerf.export());
  expect(exported.resourceSpans[0].scopeSpans[0].spans.some(span => span.name === 'reviews.load')).toBe(true);
});

for (const { zenMode, width } of [{ zenMode: false, width: 1280 }, { zenMode: true, width: 1280 }, { zenMode: true, width: 390 }]) {
  test(`form comments and unrestricted selections survive remote save and submission${zenMode ? ' in zen mode' : ''} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let state: any = { artifacts: [], revision: 1 };
    await page.route('**/__review-fixture', async route => {
      if (route.request().method() === 'POST') state = route.request().postDataJSON();
      await route.fulfill({ json: state });
    });
    await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    if (zenMode) await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true })).toHaveCount(0);
    await page.getByText('Add note about Keep this approach', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true }).fill('Keep the tested scope.');
    await page.getByText('Keep this approach', { exact: true }).click();
    await page.getByText('Revise this approach', { exact: true }).click();
    for (const name of ['Keep this approach', 'Revise this approach']) await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
    const description = page.getByText('Continue with the implementation shown in the pinned document.', { exact: true });
    await description.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    if (width === 390) await page.getByRole('button', { name: 'Comment on Reader decisions', exact: true }).click();
    else await description.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
    await expect(composer.locator('blockquote')).toHaveText('Continue with the implementation shown in the pinned document.');
    await composer.getByLabel('Your comment').fill('Clarify the next steps in this form.');
    await composer.getByRole('button', { name: 'Add to queue', exact: true }).click();
    await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
    const queue = page.getByRole('dialog', { name: 'Queued comments', exact: true });
    await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Clarify the next steps in this form.');
    await page.keyboard.press('Escape');
    await expect(queue).toHaveCount(0);
    if (zenMode) await expect(page.getByRole('dialog', { name: 'Reader decisions — Zen mode', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft remotely', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved remotely' })).toBeVisible();
    const draft = state.artifacts.find((item: any) => item.value.kind === 'review-draft').value;
    expect(draft.forms[0].answers.decision).toMatchObject({ keep: true, revise: true });
    expect(draft.forms[0].answers.decision_keep_more_info).toBe('Keep the tested scope.');
    expect(draft.comments[0]).toMatchObject({ member_id: 'reader', text: 'Clarify the next steps in this form.', selection: { text: 'Continue with the implementation shown in the pinned document.', representation: 'rendered-form' } });
    await page.reload();
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    if (zenMode) await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    for (const name of ['Keep this approach', 'Revise this approach']) await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true })).toHaveValue('Keep the tested scope.');
    await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
    await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Clarify the next steps in this form.');
    await queue.getByRole('button', { name: 'Close comments', exact: true }).click();
    await finishForm(page);
    await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Response saved remotely' })).toBeVisible();
    const response = state.artifacts.find((item: any) => item.value.kind === 'review-response').value;
    expect(response.forms[0].answers.decision).toMatchObject({ keep: true, revise: true });
    expect(response.forms[0].answers.decision_keep_more_info).toBe('Keep the tested scope.');
    expect(response.comments).toEqual(draft.comments);
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`form zen mode isolates the form, keeps Back sticky and preserves answers at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    await page.getByText('Keep this approach', { exact: true }).click();
    await page.getByRole('button', { name: 'Next question', exact: true }).click();
    await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep my place and answers in zen mode.');
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    const zen = page.getByRole('dialog', { name: 'Reader decisions — Zen mode', exact: true });
    await expect(zen).toBeVisible();
    await expect(zen.getByRole('heading', { name: 'Additional notes', exact: true })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Review inbox', exact: true })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Review items', exact: true })).toHaveCount(0);
    await expect(zen.getByRole('button', { name: /Comments ·/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Check for updates and receipts' })).toHaveCount(0);
    const bounds = (await zen.boundingBox())!;
    expect(bounds).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      // Native dialogs may hand focus to browser chrome between tab cycles,
      // represented by body; no background application control may receive it.
      expect(await zen.evaluate(node => node.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    }
    await zen.evaluate(node => { node.scrollTop = node.scrollHeight; });
    const back = zen.getByRole('button', { name: '← Back', exact: true });
    await expect(back).toHaveCount(1);
    const position = (await back.boundingBox())!;
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeLessThan(30);
    expect(position.x).toBeLessThan(30);
    expect(await back.evaluate(node => getComputedStyle(node).fontWeight)).toBe('400');
    expect(await zen.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await zen.getByRole('button', { name: 'Save draft remotely', exact: true }).click();
    await expect(zen.getByRole('status')).toContainText('Draft saved remotely');
    await zen.getByRole('button', { name: 'Previous question', exact: true }).click();
    await expect(zen.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
    const heading = zen.getByRole('heading', { name: 'Next steps', exact: true });
    await expect(heading).toBeFocused();
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual((await back.boundingBox())!.y + position.height);
    await zen.getByRole('button', { name: 'Next question', exact: true }).click();
    await expect(zen.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep my place and answers in zen mode.');
    await back.click();
    await expect(zen).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zen mode', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep my place and answers in zen mode.');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(zen).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zen mode', exact: true })).toBeFocused();
  });
}

test('zen mode shows successful submission and transport failures without leaving the form', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1, failSecond: true };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Response saved remotely');
  await expect(page.getByRole('button', { name: 'Submit just this form', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Second form transport unavailable');
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Revise this approach', exact: true })).toBeChecked();
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
});

test('remote draft survives a fresh page, two packets stay isolated, and update does not rebind answers', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('heading', { name: 'Reader follow-up', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Preserve my remote draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved remotely' })).toBeVisible();
  expect(state.artifacts).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Preserve my remote draft');
  state.revision = 2;
  await page.getByRole('button', { name: 'Check for updates and receipts' }).click();
  await expect(page.getByText('Updated packet available.')).toBeVisible();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  expect(state.artifacts.find((item: any) => item.value.kind === 'review-response').value.request.version).toBe('e'.repeat(40));
  await page.getByRole('link', { name: 'Review inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Independent reader review' }).click();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByLabel('Keep this approach', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
});
test('partial form failure retains the successful response receipt', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1, failSecond: true };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form' }).click();
  await expect(page.getByRole('alert')).toContainText('Second form transport unavailable');
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
});
test('failed submission reload restores answers and exact pending response without auto-submit', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1, failSecond: true };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Second form transport unavailable');
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('review-answer-recovery:'))!)!).pending.id);
  expect(state.artifacts).toHaveLength(0);
  state.failSecond = false;
  await page.reload();
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Revise this approach', exact: true })).toBeChecked();
  expect(state.artifacts).toHaveLength(0);
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  expect(state.artifacts[0].value.id).toBe(pending);
});

test('full document stays readable when its pinned baseline is unavailable', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--unavailable-baseline&viewMode=story');
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pinned baseline unavailable');
  await page.getByRole('button', { name: 'Full document', exact: true }).click();
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
});
test('pinned Markdown changes render rich text and the baseline remains inspectable', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  const changes = page.getByRole('region', { name: 'Document changes', exact: true });
  await expect(changes.locator('[data-change=removed]')).toContainText('The baseline had browser-only drafts.');
  await expect(changes.locator('[data-change=added]')).toContainText('Remote drafts survive reopening.');
  await expect(changes.getByRole('heading', { name: 'Reader plan', exact: true })).toBeVisible();
  await expect(page.locator('.monaco-diff-editor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Baseline', exact: true }).click();
  await expect(page.getByText('The baseline had browser-only drafts.')).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`rich Markdown changes preserve formatting, safety and document tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/iframe.html?id=web-app-reviews--rich-changes&viewMode=story');
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    const changes = page.getByRole('region', { name: 'Document changes', exact: true });
    const removed = changes.locator('[data-change=removed]');
    const added = changes.locator('[data-change=added]');
    await expect(changes.getByRole('heading', { name: 'Reader plan', exact: true })).toHaveCount(1);
    await expect(removed.locator('strong')).toHaveText('local drafts');
    await expect(added.locator('strong')).toHaveText('remote drafts');
    await expect(removed.getByRole('listitem')).toHaveText(['Save in the browser', 'Reopen this tab']);
    await expect(added.getByRole('listitem')).toHaveText(['Save remotely', 'Reopen any tab']);
    await expect(removed.getByRole('table')).toContainText('One tab');
    await expect(added.getByRole('table')).toContainText('Persistent');
    await expect(removed.locator('blockquote')).toHaveText('This warning was removed.');
    await expect(removed.locator('pre code')).toHaveText('const storage = "local";\n');
    await expect(added.locator('pre code')).toHaveText('const storage = "remote";\n');
    await expect(added.getByRole('heading', { name: 'Added section', exact: true })).toBeVisible();
    await expect(added.locator('em')).toHaveText('updated');
    await expect(added.getByRole('link', { name: 'workspace', exact: true })).toHaveAttribute('href', 'https://example.com/guide');
    await expect(added.locator('a').filter({ hasText: 'Unsafe' })).not.toHaveAttribute('href');
    await expect(changes.locator('script, [onclick], [onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => 'markdownDiffInjected' in window)).toBe(false);
    await expect(changes.getByRole('img', { name: 'Mermaid diagram', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(changes.locator('svg')).toHaveCount(1);
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    await expect(page.locator('.markdown-preview strong')).toHaveText('local drafts');
    await expect(page.getByRole('heading', { name: 'Added section', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Full document', exact: true }).click();
    await expect(page.locator('.markdown-preview strong')).toHaveText('remote drafts');
    await expect(page.getByRole('heading', { name: 'Added section', exact: true })).toBeVisible();
  });
}

test('identical Markdown revisions show one readable document and a no-changes status', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--unchanged&viewMode=story');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  const changes = page.getByRole('region', { name: 'Document changes', exact: true });
  await expect(changes.getByRole('status')).toHaveText('No rendered changes between these pinned revisions.');
  await expect(changes.locator('[data-change=added], [data-change=removed]')).toHaveCount(0);
  await expect(changes.getByRole('heading', { name: 'Reader plan', exact: true })).toHaveCount(1);
});

test('non-Markdown changes retain the read-only source diff', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--source-changes&viewMode=story');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.review-markdown-diff')).toHaveCount(0);
});
test('repeated packet submission preserves the original receipt without a second response', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByText('I have reviewed this item', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('already has a saved response receipt');
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
});
test('submitted answers take precedence over an older saved draft after reopen', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Older saved draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved remotely');
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('The submitted answer');
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit just this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('The submitted answer');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toBeDisabled();
});

test('phone question navigation preserves answers, scrolls and focuses the new question, with compact Ark checkboxes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveCount(0);
  const checkbox = page.getByRole('checkbox', { name: 'Keep this approach', exact: true });
  await page.getByText('Keep this approach', { exact: true }).click();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).not.toBeChecked();
  await checkbox.press('Space');
  const control = page.locator('.review-checkbox').first().locator('[data-part=control]');
  const size = (await control.boundingBox())!;
  expect(size.width).toBe(24);
  expect(size.height).toBe(24);
  expect((await page.locator('.review-checkbox').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Additional notes', exact: true });
  await expect(heading).toBeFocused();
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  expect((await heading.boundingBox())!.y).toBeLessThan(80);
  await expect(checkbox).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep notes across question navigation');
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep notes across question navigation');
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
});

test('document progress appears only after load, stays above content, and is optional for submission', async ({ page }) => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  let state: any = { artifacts: [], revision: 1 };
  let reads = 0;
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    // Resolve the listing, then deterministically hold document reads. Inspecting
    // the DOM in this handler races the very loading state being tested.
    if (route.request().method() === 'GET' && ++reads > 1) await loading;
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByText('Loading Reader plan…', { exact: true })).toBeVisible({ timeout: 30000 });
  const marker = page.getByRole('checkbox', { name: 'I have reviewed this item', exact: true });
  await expect(marker).toHaveCount(0);
  release();
  const document = page.getByText('The full target document is pinned to this packet.');
  await expect(document).toBeVisible();
  await expect(marker).not.toBeChecked();
  expect((await page.locator('.review-progress').boundingBox())!.y).toBeLessThan((await document.boundingBox())!.y);
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  expect(state.artifacts.find((item: any) => item.value.kind === 'review-response').value.progress).toEqual([]);
});

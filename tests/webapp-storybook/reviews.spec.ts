import { expect, test, type Page } from '@playwright/test';

async function finishForm(page: Page) {
  while (await page.getByRole('button', { name: 'Next question', exact: true }).count()) await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
}

for (const width of [1280, 390]) {
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
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    const zen = page.getByRole('dialog', { name: 'Reader plan — Zen mode', exact: true });
    await expect(zen.getByRole('heading', { name: 'Reader plan', level: 2, exact: true })).toBeFocused();
    expect(await zen.boundingBox()).toMatchObject({ x: 0, y: 0, width, height: 844 });
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
    await expect(page.getByText(/^Notes for /)).toHaveCount(0);
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
    expect(draft.comments[0]).toMatchObject({ member_id: 'reader', text: 'Clarify the next steps in this form.', selection: { text: 'Continue with the implementation shown in the pinned document.', representation: 'rendered-form' } });
    await page.reload();
    await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
    if (zenMode) await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    for (const name of ['Keep this approach', 'Revise this approach']) await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
    await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Clarify the next steps in this form.');
    await queue.getByRole('button', { name: 'Close comments', exact: true }).click();
    await finishForm(page);
    await page.getByRole('button', { name: 'Submit this form', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Response saved remotely' })).toBeVisible();
    const response = state.artifacts.find((item: any) => item.value.kind === 'review-response').value;
    expect(response.forms[0].answers.decision).toMatchObject({ keep: true, revise: true });
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
  await page.getByRole('button', { name: 'Submit this form', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Response saved remotely');
  await expect(page.getByRole('button', { name: 'Submit this form', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form', exact: true }).click();
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
  await page.getByRole('button', { name: 'Submit this form' }).click();
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
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByRole('alert')).toContainText('Second form transport unavailable');
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
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
  await page.getByRole('button', { name: 'Submit this form' }).click();
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

import { test, expect } from '@playwright/test';

test('global notes stay separate from questions and retain their value across review and zen', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/iframe.html?id=forms--pending&viewMode=story&args=theme:${theme}`);
    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    const notes = page.getByRole('region', { name: 'Additional notes', exact: true });
    await expect(notes).toBeVisible();
    expect((await notes.boundingBox())!.y).toBeGreaterThanOrEqual((await questions.boundingBox())!.y + (await questions.boundingBox())!.height);
    await expect(questions.locator('[name="additional_notes"]')).toHaveCount(0);
    await notes.getByRole('textbox').fill(`Whole-form context in ${theme} mode.`);
    await questions.getByRole('button', { name: '2. What context matters?', exact: true }).click();
    await expect(notes.getByRole('textbox')).toHaveValue(`Whole-form context in ${theme} mode.`);
    await questions.locator('.question-index').getByRole('button', { name: 'Review answers', exact: true }).click();
    await expect(notes).toBeVisible();
    await questions.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('region', { name: 'Additional notes', exact: true }).getByRole('textbox')).toHaveValue(`Whole-form context in ${theme} mode.`);
    await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  }
  await page.goto('/iframe.html?id=corner-cases--minimal-form&viewMode=story');
  await expect(page.getByRole('region', { name: 'Additional notes', exact: true }).getByRole('textbox')).toHaveCount(1);
  await page.goto('/iframe.html?id=corner-cases--notes-only&viewMode=story');
  await expect(page.getByRole('region', { name: 'Additional notes', exact: true }).getByRole('textbox')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Questions', exact: true })).toHaveCount(0);
});

test('20-comment PR keeps five forms independently navigable and routes a posted response to its source', async ({ page }) => {
  await page.goto('/iframe.html?id=corner-cases--twenty-comments-five-forms&viewMode=story');
  await expect(page.locator('[data-story-renderer] .form-card')).toHaveCount(5);
  await expect(page.locator('.gh-timeline > .gh-comment-row')).toHaveCount(20);
  await expect(page.locator('.gh-thread-tabs')).toContainText('Conversation 20');
  await page.evaluate(() => scrollTo(0, 0));
  const pending = page.getByRole('region', { name: 'Pending forms', exact: true });
  await expect(pending).toContainText('5 forms need input');
  await pending.getByRole('combobox', { name: 'Choose pending form' }).selectOption({ label: 'Scope and priorities' });
  await pending.getByRole('button', { name: 'Go to form', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Scope and priorities');
  await dialog.getByRole('checkbox', { name: 'A small focused change', exact: true }).check();
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace', exact: true }).click();
  const workspace = page.getByRole('complementary', { name: 'GitHub Ultimate PR workspace' });
  await expect(workspace.locator('.record-link')).toHaveCount(5);
  await workspace.getByRole('button', { name: 'Needs input · Follow-up work', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Follow-up work');
  await expect(dialog.getByRole('checkbox', { name: 'A small focused change', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'What context matters?', exact: true }).fill('Only the fifth form receives this response.');
  await dialog.locator('.question-index').getByRole('button', { name: 'Review answers', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  await dialog.getByRole('button', { name: 'Place in GitHub comment editor', exact: true }).click();
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const forms = page.locator('[data-story-renderer] .form-card');
  await expect(forms.nth(4)).toHaveAttribute('data-state', 'submitted');
  await expect(forms.nth(0)).not.toHaveAttribute('data-state', 'submitted');
  await expect(forms.nth(0).getByRole('checkbox', { name: 'A small focused change', exact: true })).toBeChecked();
  await expect(page.locator('.gh-posted-timeline')).toContainText('Only the fifth form receives this response.');
  await expect(page.locator('.gh-timeline > .gh-comment-row')).toHaveCount(20);
});

test('30-question phone form reaches its last question and reviews omissions without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=corner-cases--thirty-questions-phone&viewMode=story');
  const index = page.locator('.question-index');
  await expect(index.getByRole('button')).toHaveCount(31);
  await expect(page.locator('.wizard-progress')).toHaveText('Question 1 of 30');
  await index.getByRole('button', { name: '30. Recovery checkpoint 30', exact: true }).click();
  await expect(page.locator('.wizard-progress')).toHaveText('Question 30 of 30');
  await page.getByRole('textbox', { name: 'Recovery checkpoint 30', exact: true }).fill('Verify the last checkpoint.');
  await page.locator('.wizard-header .wizard-navigation').getByRole('button', { name: 'Review answers', exact: true }).click();
  await expect(page.locator('.wizard-progress')).toHaveText('Review · 30 questions');
  await expect(page.locator('.answer-review')).toContainText('29 requested questions are unanswered');
  await expect(page.locator('.answer-review')).toContainText('Verify the last checkpoint.');
  expect(await page.locator('.wizard-header').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.locator('.gh-mock').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('duplicate labels stay independent, notes-only skips the wizard, and long saved answers remain complete', async ({ page }) => {
  await page.goto('/iframe.html?id=corner-cases--duplicate-visible-labels&viewMode=story');
  const choices = page.getByRole('checkbox', { name: 'Production', exact: true });
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toBeChecked();
  await expect(choices.nth(1)).not.toBeChecked();
  await choices.nth(1).check();
  await choices.nth(0).uncheck();
  await expect(choices.nth(1)).toBeChecked();
  await page.goto('/iframe.html?id=corner-cases--notes-only&viewMode=story');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveCount(1);
  await expect(page.locator('.question-index')).toHaveCount(0);
  await expect(page.locator('.wizard-progress')).toHaveCount(0);
  await page.goto('/iframe.html?id=corner-cases--maximum-length-saved-answer&viewMode=story');
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  const answer = await page.locator('.saved-answers blockquote').first().innerText();
  expect(answer.trim().length).toBe(16000);
  await expect(page.locator('.saved-answers textarea')).toHaveCount(0);
});

test('every indexed story renders the shipping UI or its intentional native fallback', async ({ page, request }) => {
  const index = await (await request.get('/index.json')).json();
  const entries = Object.values(index.entries) as { id: string; type: string }[];
  const stories = entries.filter(entry => entry.type === 'story');
  expect(stories.length).toBeGreaterThanOrEqual(48);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const story of stories) {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    await expect(page.locator('[data-story-renderer]').first()).toBeVisible();
    await expect(page.locator('[data-story-renderer]').locator('.form-card, .snapshot, [role="alert"]')).not.toHaveCount(0);
    if (story.id.startsWith('corner-cases--')) await expect(page.locator('[data-story-renderer] .error').filter({ hasText: /Invalid record|could not render/ })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('Other, independent selections, preview, native draft and simulated history form a complete local loop', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--pending&viewMode=story');
  await expect(page.getByRole('group', { name: 'What kind of change should we make?' })).toBeVisible();
  const commentButton = page.getByRole('button', { name: 'Leave a comment about A small focused change', exact: true });
  await expect(commentButton).toHaveText('Leave a comment');
  await commentButton.click();
  await expect(page.getByRole('textbox', { name: 'Add note about A small focused change', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'A small focused change', exact: true }).check();
  await page.getByRole('checkbox', { name: 'A broader investigation', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'A small focused change', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Other', exact: true }).check();
  await page.getByRole('textbox', { name: 'Add note about Other', exact: true }).fill('Combine the approaches.');
  await page.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  await page.getByRole('textbox', { name: 'What context matters?', exact: true }).fill('m stays text.');
  await page.getByRole('button', { name: 'Review answers', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Generated comment preview' })).toHaveValue(/Combine the approaches/);
  await page.getByRole('button', { name: 'Place in GitHub comment editor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Local GitHub comment editor', exact: true })).toHaveValue(/^My existing native comment draft\.\n\n\/github-ultimate discuss/);
  await expect(page.getByRole('button', { name: 'View submitted answers', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  await expect(page.locator('.saved-answers')).toContainText('Combine the approaches.');
  await expect(page.getByRole('status').filter({ hasText: 'Nothing was sent to GitHub' })).toBeVisible();
});

test('mock GitHub includes a PR timeline, safe native preview, posted comments and workspace navigation', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://github.com/')) outbound.push(request.url()); });
  await page.goto('/iframe.html?id=github-conversation--pull-request&viewMode=story');
  await expect(page.getByRole('region', { name: 'Mock GitHub conversation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make workspace feedback easier to review #42', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Conversation navigation (visual fixture)' })).toContainText('Files changed');
  await expect(page.locator('.gh-comment-card').filter({ has: page.locator('[data-story-renderer]') })).toContainText('github-ultimate[bot]');
  await expect(page.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/storybook/github-conversation.png', fullPage: true });
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace', exact: true }).click();
  const workspace = page.getByRole('complementary', { name: 'GitHub Ultimate PR workspace' });
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name: 'Needs input · Plan the next change', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Local GitHub comment editor', exact: true });
  await editor.fill('An ordinary **local comment**. <img src=x onerror="window.mockPwned=1">');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.gh-native-preview strong')).toHaveText('local comment');
  await expect(page.locator('.gh-native-preview img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.locator('.gh-posted-timeline')).toContainText('An ordinary local comment.');
  await expect(page.getByRole('button', { name: 'View submitted answers', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { mockPwned?: number }).mockPwned)).toBeUndefined();
  expect(outbound).toEqual([]);
});

test('long conversation has a pending zen entry; issue and phone fixtures fit their context', async ({ page }) => {
  await page.goto('/iframe.html?id=github-conversation--long-conversation&viewMode=story');
  expect((await page.locator('.gh-timeline').boundingBox())!.width).toBe(814);
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('button', { name: 'Go to form', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  await page.goto('/iframe.html?id=github-conversation--issue&viewMode=story');
  await expect(page.locator('.gh-thread-subtitle')).toContainText('opened this issue');
  await expect(page.getByRole('navigation', { name: 'Conversation navigation (visual fixture)' })).not.toContainText('Files changed');
  await page.goto('/iframe.html?id=github-conversation--mobile-dark&viewMode=story');
  await expect(page.locator('.gh-mock')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.gh-sidebar')).toBeHidden();
  expect(await page.locator('.gh-mock').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('submitted history is read-only and a new response starts empty', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--submission-history&viewMode=story');
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  await expect(page.locator('.saved-answers h3')).toHaveCount(2);
  await expect(page.locator('.saved-answers').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit another response', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'A small focused change', exact: true })).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
});

test('phone and zen keep seeded values while raw invalid records and unsafe markdown stay inert', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=forms--dark-phone&viewMode=story');
  await page.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What context matters?', exact: true });
  const value = await input.inputValue();
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(input).toHaveValue(value);
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  await expect(input).toHaveValue(value);
  await page.goto('/iframe.html?id=fallbacks--unsupported-field&viewMode=story');
  await expect(page.getByRole('alert')).toContainText('Invalid record');
  await expect(page.locator('[data-story-renderer] pre')).toContainText('untrusted-action.yml');
  await page.goto('/iframe.html?id=fallbacks--unsafe-markdown&viewMode=story');
  await expect(page.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
  await page.getByText('Context', { exact: true }).click();
  await expect(page.locator('.markdown img, .markdown script, .markdown a[href^="javascript:"]')).toHaveCount(0);
});

test('Storybook manager opens a navigable story canvas', async ({ page }) => {
  await page.goto('/?path=/story/forms--pending');
  await expect(page.locator('#storybook-preview-iframe')).toBeVisible();
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Controls/ }).click();
  const jsonControl = page.getByRole('row').filter({ hasText: 'Raw JSON' });
  await expect(jsonControl).toContainText('storybook_plan');
  await jsonControl.getByRole('switch', { name: 'Edit source as JSON', exact: true }).click();
  const raw = jsonControl.getByPlaceholder('Edit JSON string...');
  const record = JSON.parse(await raw.inputValue());
  expect(record.questions[0].title).toBe('What kind of change should we make?');
  record.title = 'Edited through the Raw JSON knob';
  await raw.fill(JSON.stringify(record, null, 2));
  await raw.press('Tab');
  await expect(canvas.getByRole('heading', { name: 'Edited through the Raw JSON knob', exact: true })).toBeVisible();
});

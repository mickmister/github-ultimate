import { test, expect } from '@playwright/test';

test('rendered annotations survive reload and stay synchronized with side and queue edits/deletions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-feedback--inline-comments&viewMode=story');
  const text = page.locator('.markdown-preview strong').first();
  await text.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); });
  await text.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByLabel('Your comment').fill('Explain this phrase.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  const notes = page.getByRole('complementary', { name: 'Document comments', exact: true });
  await expect(notes.getByLabel('Edit queued comment 1', { exact: true })).toHaveValue('Explain this phrase.');
  await expect(page.locator('.feedback-text-highlight').first()).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('github-ultimate:feedback:v1')!));
  expect(saved.interactions[0].context.selection.prefix).not.toContain('Comment');
  expect(saved.interactions[0].context.selection.textRange.endOffset).toBeGreaterThan(saved.interactions[0].context.selection.textRange.startOffset);
  expect(saved.interactions[0].context).not.toHaveProperty('pageUrl');
  const contentBounds = await page.locator('[data-feedback-content]').boundingBox(), rail = await notes.boundingBox();
  expect(rail!.x).toBeGreaterThan(contentBounds!.x + contentBounds!.width);
  await page.getByRole('button', { name: 'Show comment 1', exact: true }).click();
  await expect(notes.locator('.feedback-inline-comment')).toBeFocused();
  await notes.getByLabel('Edit queued comment 1', { exact: true }).fill('Edited beside the document.');
  await page.reload();
  await expect(notes.getByLabel('Edit queued comment 1', { exact: true })).toHaveValue('Edited beside the document.');
  await expect(page.locator('.feedback-text-highlight').first()).toBeVisible();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  const queue = page.getByRole('dialog', { name: 'Queued comments', exact: true });
  await expect(queue.getByLabel('Comment 1', { exact: true })).toHaveValue('Edited beside the document.');
  await queue.getByLabel('Comment 1', { exact: true }).fill('Edited from the queue.');
  await page.getByRole('button', { name: 'Close comments', exact: true }).click();
  await expect(notes.getByLabel('Edit queued comment 1', { exact: true })).toHaveValue('Edited from the queue.');
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await queue.getByRole('button', { name: 'Remove comment 1', exact: true }).click();
  await page.getByRole('button', { name: 'Close comments', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(page.locator('.feedback-text-highlight')).toHaveCount(0);
});

test('overlapping comments have separate indicators and only the matching revision is annotated', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--reading-document&viewMode=story');
  for (const [index, comment] of ['First reaction', 'Overlapping reaction'].entries()) {
    const quote = page.locator('.markdown-preview strong').first();
    await quote.evaluate((node, index) => { const range = document.createRange(); range.selectNodeContents(node); if (index) range.setStart(node.parentNode!.firstChild!, 0); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); }, index);
    await quote.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
    await page.getByLabel('Your comment').fill(comment);
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  }
  const markers = page.locator('.feedback-comment-marker');
  await expect(markers).toHaveCount(2);
  const first = await markers.nth(0).boundingBox(), second = await markers.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  await expect.poll(async () => {
    const cards = page.locator('.feedback-inline-comment');
    const first = await cards.nth(0).boundingBox(), second = await cards.nth(1).boundingBox();
    return second!.y - first!.y - first!.height;
  }).toBeGreaterThanOrEqual(8);
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem('github-ultimate:feedback:v1')!);
    draft.interactions.push({ ...draft.interactions[0], id: 'other-revision', context: { ...draft.interactions[0].context, target: { ...draft.interactions[0].context.target, resource: { ...draft.interactions[0].context.target.resource, revision: 'another-commit' } } } });
    draft.interactions.push({ ...draft.interactions[0], id: 'missing-quote', context: { ...draft.interactions[0].context, selection: { representation: 'rendered-markdown', text: 'This quote is no longer present.' } } });
    sessionStorage.setItem('github-ultimate:feedback:v1', JSON.stringify(draft));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Comments · 4', exact: true })).toBeVisible();
  await expect(page.locator('.feedback-inline-comment')).toHaveCount(3);
  await expect(page.locator('.feedback-comment-marker')).toHaveCount(2);
  await expect(page.getByText('Passage could not be matched in this view.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete queued comment 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comments · 3', exact: true })).toBeVisible();
  await expect(page.locator('.feedback-comment-marker')).toHaveCount(1);
});

test('source comments use model decorations, survive view switches, and clear after queue export', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-document-browser--source-document&viewMode=story');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 30000 });
  await page.getByRole('textbox', { name: 'Read-only document source' }).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('.monaco-editor .view-lines').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByLabel('Your comment').fill('Clarify this Markdown source.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.locator('.monaco-editor .feedback-source-highlight').first()).toBeVisible();
  await page.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  await expect(page.getByText('Selected in source view.', { exact: true })).toBeVisible();
  await expect(page.locator('.feedback-text-highlight')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show selected view', exact: true }).click();
  await expect(page.locator('.monaco-editor .feedback-source-highlight').first()).toBeVisible();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Copy review & clear', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No comments queued.');
  await page.getByRole('button', { name: 'Close comments', exact: true }).click();
  await expect(page.locator('.feedback-source-highlight')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Document comments', exact: true })).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

const cases = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 1000, 1500], ['desktop', 'landscape', 1500, 1000],
] as const;
for (const [surface, orientation, width, height] of cases) {
  test(`${surface} ${orientation}: production composer and queue`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/iframe.html?id=web-app-feedback-surfaces--${surface}-${orientation}&viewMode=story`);
    await page.getByRole('button', { name: 'Comment on Pinned document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
    await expect(page.locator('.feedback-composition')).toHaveAttribute('data-surface', surface);
    await expect(page.locator('.feedback-composition')).toHaveAttribute('data-orientation', orientation);
    await page.getByLabel('Your comment').fill('A local draft, not a delivered review.');
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Comment on Pinned document', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
    await expect(page.getByLabel('Comment 1', { exact: true })).toHaveValue('A local draft, not a delivered review.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/feedback/${surface}-${orientation}.png` });
  });
}

test('captured selection, draft, caret, pinned context and queue failure survive surface swaps and separate review navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/iframe.html?id=web-app-feedback-surfaces--survival&viewMode=story');
  const passage = page.getByTestId('feedback-passage');
  await passage.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await passage.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByLabel('Your comment').fill('Unfinished composer');
  await page.getByLabel('Your comment').evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(3, 8));
  for (const [, , width, height] of cases) {
    await page.setViewportSize({ width, height });
    await expect(page.getByLabel('Your comment')).toHaveValue('Unfinished composer');
    await expect(page.getByLabel('Your comment')).toBeFocused();
    expect(await page.getByLabel('Your comment').evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([3, 8]);
  }
  await page.evaluate(() => { history.pushState({}, '', '#review'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('button', { name: 'Comments · 0', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Comment on Review document', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Feature', exact: true }).click();
  await page.getByLabel('Your comment').fill('Separate session queue');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.evaluate(() => { history.pushState({}, '', '#global'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByLabel('Your comment')).toHaveValue('Unfinished composer');
  await expect(page.locator('blockquote')).toHaveText('Original selected passage, unchanged by navigation.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await page.getByLabel('Comment 1', { exact: true }).fill('Edited queue draft');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } }));
  await page.getByRole('button', { name: 'Copy Content & clear Content', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your comments are still queued');
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByLabel('Comment 1', { exact: true })).toHaveValue('Edited queue draft');
  await expect(page.getByRole('dialog')).toContainText('Your comments are still queued');
  await page.evaluate(() => { history.pushState({}, '', '#review'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await expect(page.getByLabel('Comment 1', { exact: true })).toHaveValue('Separate session queue');
  await page.evaluate(() => { history.pushState({}, '', '#global'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByLabel('Comment 1', { exact: true })).toHaveValue('Edited queue draft');
  await expect(page.getByRole('dialog')).toContainText('Your comments are still queued');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('feedback:survival')!));
  expect(saved.interactions[0].context.target.resource.revision).toBe('exact-revision');
  expect(saved.interactions[0].context.target.resource.workspace).toBe('workspace-a');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Comments · 1', exact: true })).toBeFocused();
});

test('keyboard menu retains category restrictions and selection-copy failure survives rotation', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-feedback--nested-targets&viewMode=story');
  const feature = page.getByRole('button', { name: 'Comment on document browser', exact: true });
  await feature.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Comment on Content', exact: true })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');
  await expect(feature).toBeFocused();
  const passage = page.locator('.markdown-preview strong').first();
  await passage.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await passage.click({ button: 'right' });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } }));
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.feedback-dock')).toContainText('Clipboard copy failed.');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.feedback-dock')).toContainText('Clipboard copy failed.');
  await expect(page.getByRole('button', { name: 'Comments · 0', exact: true })).toBeVisible();
});

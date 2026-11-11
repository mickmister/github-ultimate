import { test, expect } from '@playwright/test';

test.use({ browserName: 'webkit', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
test('phone annotations keep touch selection, stack comments and support deletion without overflow', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--reading-document&viewMode=story');
  const quote = page.locator('.markdown-preview strong').first();
  await quote.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); });
  await page.getByRole('button', { name: 'Comment on planning/product-brief.md', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).tap();
  await expect(page.getByRole('dialog').locator('blockquote')).toContainText('calmer engineering workspace');
  await page.getByLabel('Your comment').fill('Phone note');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).tap();
  await expect(page.locator('.feedback-text-highlight').first()).toBeVisible();
  const content = await page.locator('[data-feedback-content]').boundingBox(), notes = await page.getByRole('complementary', { name: 'Document comments', exact: true }).boundingBox();
  expect(notes!.y).toBeGreaterThanOrEqual(content!.y + content!.height);
  await page.getByRole('button', { name: 'Show comment 1', exact: true }).tap();
  await page.getByLabel('Edit queued comment 1', { exact: true }).fill('Edited phone note');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Delete queued comment 1', exact: true }).tap();
  await expect(page.locator('.feedback-text-highlight')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Comments · 0', exact: true })).toBeVisible();
});

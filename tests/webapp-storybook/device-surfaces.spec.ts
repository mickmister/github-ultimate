import { test, expect } from '@playwright/test';

const configurations = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 900, 1440], ['desktop', 'landscape', 1440, 900],
] as const;
for (const [surface, orientation, width, height] of configurations) {
  test(`${surface} ${orientation}: real controller, accessible navigation and bounded content`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/iframe.html?id=web-app-documents-surfaces--${surface}-${orientation}&viewMode=story`);
    const screen = page.locator(`main[data-surface="${surface}"]`);
    await expect(screen).toHaveAttribute('data-orientation', orientation);
    await expect(page.locator('main[data-surface]')).toHaveCount(1);
    await expect(screen.locator('[data-region="documents.navigation"]')).toHaveCount(1);
    await page.getByLabel('Storage repository').fill('octo-example/workspace-storage');
    await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
    await page.getByLabel('Stored workspace').selectOption('product-research');
    await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
    await page.getByRole('treeitem', { name: 'planning', exact: true }).click();
    await page.getByRole('treeitem', { name: 'planning/product-brief.md', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Markdown preview', exact: true })).toContainText('deterministic Storybook fixture data');
    const back = page.getByRole('button', { name: 'Back to documents', exact: true });
    await expect(back).toBeVisible();
    const box = await back.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('surface and orientation changes preserve feature/controller selection and search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-documents-surfaces--adaptive&viewMode=story');
  await page.getByLabel('Storage repository').fill('octo-example/workspace-storage');
  await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
  await page.getByLabel('Stored workspace').selectOption('product-research');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await page.getByLabel('Find a document').fill('product-brief');
  await page.getByRole('treeitem', { name: 'planning/product-brief.md', exact: true }).click();
  await page.getByRole('button', { name: 'Comment on planning/product-brief.md', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByLabel('Your comment').fill('Keep this unfinished comment across surfaces.');
  for (const [surface, orientation, width, height] of configurations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('main[data-surface]')).toHaveAttribute('data-surface', surface);
    await expect(page.locator('main[data-surface]')).toHaveAttribute('data-orientation', orientation);
    await expect(page.locator('.markdown-preview')).toContainText('deterministic Storybook fixture data');
    await expect(page.getByLabel('Your comment')).toHaveValue('Keep this unfinished comment across surfaces.');
  }
  await page.getByRole('button', { name: 'Close comments', exact: true }).click();
  await page.getByRole('button', { name: 'Back to documents', exact: true }).click();
  await expect(page.getByLabel('Find a document')).toHaveValue('product-brief');
});
test('height-only keyboard resize preserves tablet layout and focused input', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/iframe.html?id=web-app-documents-surfaces--adaptive&viewMode=story');
  const input = page.getByLabel('Storage repository');
  await input.fill('octo-example/workspace-storage');
  await input.focus();
  await page.setViewportSize({ width: 820, height: 500 });
  await expect(page.locator('main[data-surface]')).toHaveAttribute('data-surface', 'tablet');
  await expect(page.locator('main[data-surface]')).toHaveAttribute('data-orientation', 'portrait');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('octo-example/workspace-storage');
  await page.setViewportSize({ width: 820, height: 1180 });
  await input.blur();
});

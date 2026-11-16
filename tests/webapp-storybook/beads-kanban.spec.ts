import { test, expect } from '@playwright/test';

test('browses native-shaped issues, filters readiness and keeps card density independent of selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/iframe.html?id=web-app-beads-kanban--compact&viewMode=story');
  await expect(page.locator('.beads-count')).toContainText('6 matching / 7');
  await page.getByRole('combobox', { name: /Native readiness/ }).selectOption('blocked');
  await expect(page.locator('.beads-count')).toContainText('1 matching / 7');
  const card = page.getByRole('button', { name: 'Open demo-1.2:', exact: false });
  await card.focus(); await page.keyboard.press('Enter');
  const details = page.getByRole('complementary', { name: 'Issue details: demo-1.2' });
  await expect(details).toBeFocused();
  await expect(details).toContainText('dependency-blocked, not stored as blocked');
  await page.getByLabel('Card density').selectOption('comfortable');
  await expect(details).toBeVisible();
  await page.getByRole('button', { name: 'Close issue details' }).click();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Include closed').check();
  await expect(page.locator('.beads-count')).toContainText('7 matching / 7');
  await page.getByLabel('Search issues').fill('not a matching title');
  await expect(page.getByText('No issues match these filters.')).toBeVisible();
  await expect(page.getByText('This workspace snapshot has no issues.')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('clears selection and filters when the workspace changes', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-kanban--workspace-switch&viewMode=story');
  await page.getByLabel('Search issues').fill('demo-1.2');
  await page.getByRole('button', { name: 'Open demo-1.2:', exact: false }).click();
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(page.getByLabel('Search issues')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open second-1:', exact: false })).toBeVisible();
});

test('adapts to narrow dark screens and keeps browsing read-only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/iframe.html?id=web-app-beads-kanban--compact&viewMode=story');
  const card = page.getByRole('button', { name: 'Open demo-1:', exact: false });
  await card.click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: /add card|delete card|edit card/i })).toHaveCount(0);
});

test('distinguishes empty, unavailable readiness and malformed snapshots', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-kanban--empty&viewMode=story');
  await expect(page.getByText('This workspace snapshot has no issues.')).toBeVisible();
  await page.goto('/iframe.html?id=web-app-beads-kanban--readiness-unavailable&viewMode=story');
  await expect(page.getByLabel('Native readiness').locator('option[value=ready]')).toHaveAttribute('disabled', '');
  await page.goto('/iframe.html?id=web-app-beads-kanban--invalid-snapshot&viewMode=story');
  await expect(page.getByRole('alert')).toContainText('duplicate issue ID');
});

test('virtualizes a large collection without limiting searches to rendered cards', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-kanban--large-workspace&viewMode=story');
  await expect(page.locator('.beads-count')).toContainText('1000 matching / 1000');
  expect(await page.locator('.beads-card').count()).toBeLessThan(1000);
  await page.getByLabel('Search issues').fill('large-999');
  await expect(page.locator('.beads-count')).toContainText('1 matching / 1000');
  await expect(page.getByRole('button', { name: 'Open large-999:', exact: false })).toBeVisible();
});

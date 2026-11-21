import { test, expect } from '@playwright/test';

test.setTimeout(120000);
const cases = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 1000, 1600], ['desktop', 'landscape', 1600, 1000],
] as const;
for (const [surface, orientation, width, height] of cases) {
  test(`${surface} ${orientation}: production page, filters, keyboard details and return`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/iframe.html?id=web-app-beads-surfaces--${surface}-${orientation}&viewMode=story`);
    await expect(page.locator('.beads-count')).toHaveText('6 / 7', { timeout: 90000 });
    await expect(page.locator('[data-page-surface]')).toHaveAttribute('data-page-surface', surface);
    await expect(page.locator('[data-board-surface]')).toHaveAttribute('data-board-surface', surface);
    await expect(page.locator('[data-board-surface]')).toHaveCount(1);
    await page.getByLabel('Search issues').fill('demo-1.2');
    await expect(page.locator('.beads-count')).toHaveText('1 / 7');
    const card = page.getByRole('button', { name: /^Open demo-1.2:/ });
    await card.focus(); await page.keyboard.press('Enter');
    const details = page.getByRole('complementary', { name: 'Issue details: demo-1.2' });
    await expect(details).toBeFocused();
    await expect(details).toContainText('Dependency blocked');
    if (surface === 'phone') {
      await expect(page.getByLabel('Search issues')).toHaveCount(0);
      await page.getByRole('button', { name: 'Back to tasks' }).click();
    } else {
      await expect(page.getByLabel('Search issues')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(card).toBeFocused();
    await expect(page.getByLabel('Search issues')).toHaveValue('demo-1.2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('adaptive page preserves selection, active/named filters, density and unsaved name through all surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/iframe.html?id=web-app-beads-surfaces--adaptive&viewMode=story');
  await expect(page.locator('.beads-count')).toHaveText('6 / 7', { timeout: 90000 });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Search issues').fill('demo-1.2');
  await page.getByLabel('Card density').selectOption('comfortable');
  await page.getByLabel('Filter name').fill('Saved mobile');
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Board filters' })).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Filter name').fill('Unsubmitted draft');
  await page.getByRole('button', { name: /^Open demo-1.2:/ }).click();
  for (const [surface, , width, height] of [cases[2], cases[0], cases[1], cases[3], cases[4], cases[5]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-page-surface]')).toHaveAttribute('data-page-surface', surface);
    await expect(page.locator('[data-board-surface]')).toHaveAttribute('data-board-surface', surface);
    await expect(page.getByRole('complementary', { name: 'Issue details: demo-1.2' })).toBeVisible();
    if (surface !== 'phone') {
      await expect(page.getByLabel('Filter name')).toHaveValue('Unsubmitted draft');
      await expect(page.getByLabel('Search issues')).toHaveValue('demo-1.2');
      await expect(page.getByLabel('Card density')).toHaveValue('comfortable');
      await expect(page.getByLabel('Saved filters')).toHaveValue('Saved mobile');
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Open demo-1.2:/ })).toBeFocused();
});

for (const [surface, , width, height] of [cases[0], cases[2], cases[5]]) {
  test(`${surface}: bounds large collections and searches beyond the first rendered page`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/iframe.html?id=web-app-beads-surfaces--large-adaptive&viewMode=story');
    await expect(page.locator('.beads-count')).toHaveText(/\/ 2000$/, { timeout: 90000 });
    await expect(page.locator('[data-board-surface]')).toHaveAttribute('data-board-surface', surface);
    expect(await page.locator('.beads-card').count()).toBeLessThan(surface === 'desktop' ? 200 : 61);
    if (surface !== 'desktop') {
      await page.getByRole('button', { name: 'Next tasks' }).click();
      await expect(page.getByRole('button', { name: 'Previous tasks' })).toBeEnabled();
    }
    await page.getByLabel('Search issues').fill('large-1999');
    await expect(page.locator('.beads-count')).toHaveText('1 / 2000');
    await expect(page.getByRole('button', { name: /^Open large-1999:/ })).toBeVisible();
  });
}

test('offers a working retry after a snapshot failure and distinguishes not ready from unavailable', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-surfaces--retry&viewMode=story');
  await expect(page.getByRole('alert')).toContainText('Snapshot unavailable', { timeout: 90000 });
  await expect(page.getByText('Loading tasks…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.beads-count')).toHaveText('6 / 7');
  await page.getByRole('button', { name: /^Open demo-3:/ }).click();
  await expect(page.getByRole('complementary')).toContainText('Not ready');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

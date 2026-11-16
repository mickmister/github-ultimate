import { test, expect } from '@playwright/test';

test('browses native-shaped issues, filters readiness and keeps card density independent of selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/iframe.html?id=web-app-beads-kanban--compact&viewMode=story');
  await expect(page.locator('.beads-count')).toHaveText('6 / 7', { timeout: 20000 });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('combobox', { name: /^Readiness/ }).selectOption('blocked');
  await expect(page.locator('.beads-count')).toHaveText('1 / 7');
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
  await expect(page.locator('.beads-count')).toHaveText('7 / 7');
  await page.getByLabel('Search issues').fill('not a matching title');
  await expect(page.getByText('No matching issues.')).toBeVisible();
  await expect(page.getByText('No issues yet.')).toHaveCount(0);
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
  await expect(page.getByText('No issues yet.')).toBeVisible();
  await page.goto('/iframe.html?id=web-app-beads-kanban--readiness-unavailable&viewMode=story');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('Readiness').locator('option[value=ready]')).toHaveAttribute('disabled', '');
  await page.goto('/iframe.html?id=web-app-beads-kanban--invalid-snapshot&viewMode=story');
  await expect(page.getByRole('alert')).toContainText('duplicate issue ID');
});

test('virtualizes a large collection without limiting searches to rendered cards', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-kanban--large-workspace&viewMode=story');
  await expect(page.locator('.beads-count')).toHaveText('1000 / 1000');
  expect(await page.locator('.beads-card').count()).toBeLessThan(1000);
  await page.getByLabel('Search issues').fill('large-999');
  await expect(page.locator('.beads-count')).toHaveText('1 / 1000');
  await expect(page.getByRole('button', { name: 'Open large-999:', exact: false })).toBeVisible();
});

test('remembers the workspace, auto-loads on return and persists active and named filters per workspace', async ({ page }) => {
  // Shared page storage updates its UI mirror optimistically. Reload only after
  // the actual IndexedDB transaction commits, rather than racing flush().
  const persisted = () => page.evaluate(() => new Promise<{ selectedView: string; filters: { query: string }; views: { name: string }[] }[]>((resolve, reject) => {
    const open = indexedDB.open('github-ultimate-page-kv', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('values', 'readonly'), get = tx.objectStore('values').get(location.origin);
      tx.oncomplete = () => { db.close(); resolve((get.result?.entries ?? []).filter(([key]: [string, string]) => key.startsWith('github-ultimate:beads:filters:v1:')).map(([, value]: [string, string]) => JSON.parse(value))); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.goto('/iframe.html?id=web-app-beads-kanban--remembered-workspace&viewMode=story');
  await page.getByLabel('Storage repository', { exact: true }).fill('example/storage');
  await page.getByLabel('Workspace', { exact: true }).fill('first');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.beads-count')).toHaveText('6 / 7');
  await expect(page.getByRole('form', { name: 'Choose workspace' })).toHaveCount(0);
  await expect(page.getByText(/read-only proof|Verified engine release|Snapshot identity|Native query diagnostics|Store writes/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('combobox', { name: /^Label/ }).selectOption('mobile');
  await page.getByLabel('Filter name').fill('Mobile work');
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  await expect(page.getByLabel('Saved filters')).toHaveValue('Mobile work');
  await expect(page.locator('.beads-count')).toHaveText('2 / 7');
  await expect.poll(async () => (await persisted()).some(value => value.selectedView === 'Mobile work')).toBe(true);
  // Return through the bare page URL: restoration must not depend on a deep link.
  await page.evaluate(() => history.replaceState(history.state, '', location.pathname + location.search));
  await page.reload();
  await expect(page.locator('.beads-count')).toHaveText('2 / 7');
  await expect(page.getByLabel('Saved filters')).toHaveValue('Mobile work');
  await page.getByLabel('Search issues').fill('demo-1.2');
  await expect.poll(async () => (await persisted()).some(value => value.filters.query === 'demo-1.2')).toBe(true);
  await page.reload();
  await expect(page.locator('.beads-count')).toHaveText('1 / 7');
  await expect(page.getByLabel('Search issues')).toHaveValue('demo-1.2');
  await page.getByLabel('Saved filters').selectOption('Mobile work');
  await expect(page.getByLabel('Search issues')).toHaveValue('');
  await expect(page.locator('.beads-count')).toHaveText('2 / 7');
  await page.getByRole('button', { name: 'first', exact: true }).click();
  await page.getByLabel('Workspace', { exact: true }).fill('second');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.beads-count')).toHaveText('1 / 1');
  await expect(page.getByLabel('Saved filters').locator('option[value="Mobile work"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'second', exact: true }).click();
  await page.getByLabel('Workspace', { exact: true }).fill('first');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('.beads-count')).toHaveText('2 / 7');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Delete saved filter' }).click();
  await expect.poll(async () => { const values = await persisted(); return values.length > 0 && values.every(value => value.views.every(view => view.name !== 'Mobile work')); }).toBe(true);
  await page.reload();
  await expect(page.locator('.beads-count')).toHaveText('2 / 7');
  await expect(page.getByLabel('Saved filters').locator('option[value="Mobile work"]')).toHaveCount(0);
});

test('honors an explicit workspace link and refuses a remembered connection that is no longer available', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-beads-kanban--remembered-workspace&viewMode=story#/beads?connection=11111111-1111-4111-8111-111111111111&repository=example%2Fstorage&workspace=first');
  await expect(page.locator('.beads-count')).toHaveText('6 / 7', { timeout: 15000 });
  await page.goto('/iframe.html?id=web-app-beads-kanban--remembered-workspace&viewMode=story#/beads?connection=11111111-1111-4111-8111-111111111111&repository=example%2Fstorage&workspace=second');
  await expect(page.locator('.beads-count')).toHaveText('1 / 1');
  await expect(page.getByRole('button', { name: 'second', exact: true })).toBeVisible();
  await page.goto('/iframe.html?id=web-app-beads-kanban--removed-connection&viewMode=story');
  await expect(page.getByRole('form', { name: 'Choose workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeDisabled();
  await expect(page.locator('.beads-count')).toHaveCount(0);
});

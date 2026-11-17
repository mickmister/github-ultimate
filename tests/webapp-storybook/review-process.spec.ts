import { expect, test } from '@playwright/test';

test('production process context shows pinned/current evidence and retries the saved response', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--process-context&viewMode=story');
  const evidence = page.getByRole('region', { name: 'QRSPI process evidence' });
  // The first story may still be compiling on the development server.
  await expect(evidence).toContainText('QRSPI · hosted-pilot',{timeout:30000});
  await expect(evidence).toContainText('route: goals → questions → research → design → plan → implement');
  await expect(evidence).toContainText('Stale review pin');
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  const receipts = page.getByRole('list', { name: 'Submission receipts' });
  await expect(receipts).toContainText('Response saved · dispatch failed');
  await expect(receipts).toContainText('Missing installed-source Actions write route');
  const id = await receipts.locator('strong').innerText();
  await page.getByRole('button', { name: 'Retry delivery of saved response', exact: true }).click();
  await expect(receipts).toContainText('dispatch dispatched');
  await expect(receipts).toContainText('start unknown');
  await expect(receipts.locator('li')).toHaveCount(1);
  await expect(receipts.locator('strong')).toHaveText(id);
});

for (const [story, text] of [['process-loading', 'Loading pinned and current'], ['process-error', 'Position unknown, not failed'], ['process-missing-current', 'Historical pinned approval'], ['process-stale', 'Current: Metadata missing']] as const) {
  test(`production evidence presentation: ${story}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=web-app-reviews--${story}&viewMode=story`);
    await expect(page.getByRole('region', { name: 'QRSPI process evidence' })).toContainText(text);
  });
}

test('feature intake is independent of content submission and remains explicitly unrouted', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-reviews--process-context&viewMode=story');
  await page.getByRole('button', { name: 'Comment on Reader plan', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Feature', exact: true }).click();
  await page.getByLabel('Your comment').fill('Improve this review layout.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Feature feedback remains in separate app intake');
  await expect(page.getByRole('list', { name: 'Submission receipts' }).locator('li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Comment on Reader plan', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByLabel('Your comment').fill('Clarify this pinned content.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Submission receipts' })).toContainText('1 comments');
  await page.getByRole('button', { name: 'Comments · 2', exact: true }).click();
  await page.getByRole('button', { name: 'Copy Feature intake & clear Feature', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Destination workspace: UNKNOWN');
  expect(copied).toContain('Destination thread: UNKNOWN');
  expect(copied).toContain('reproduction context only');
  await expect(page.getByRole('dialog')).toContainText('Not delivered and no content process continued');
});

test('legacy production packet remains valid without process context', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await expect(page.getByRole('region', { name: 'Focused review session' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'QRSPI process evidence' })).toHaveCount(0);
});

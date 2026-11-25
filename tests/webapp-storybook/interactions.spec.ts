import { test, expect } from '@playwright/test';
import { interactionExample } from '../../webapp/stories/interactions.fixtures';

test('reviews a heterogeneous batch using the production surface and invalidates the result on edits', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/iframe.html?id=web-app-interactions--batch-review&viewMode=story');
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill(JSON.stringify(interactionExample));
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Resolved for review — no effects applied', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(4);
  await expect(page.getByText('documents: ready for review', { exact: false })).toBeVisible();
  await expect(page.getByText('native-beads: ready for review', { exact: false })).toBeVisible();
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill('{}');
  await expect(page.getByRole('heading', { name: 'Resolved for review — no effects applied', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('uses the actual Markdown renderer for a matching build, never raw-source positions', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-interactions--batch-review&viewMode=story');
  const batch = structuredClone(interactionExample);
  const item = batch.interactions[0];
  if (item.kind !== 'content-comment' || !item.context.selection) throw new Error('Invalid fixture');
  item.context.selection.representation = 'rendered-markdown';
  item.context.selection.prefix = 'The ';
  item.context.selection.suffix = ' is the dispatcher.\n';
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill(JSON.stringify(batch));
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'content-comment · ready', exact: true })).toBeVisible();
  item.context.appBuild = 'different-renderer-build';
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill(JSON.stringify(batch));
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'content-comment · unsupported', exact: true })).toBeVisible();
});

test('keeps unsupported native items visible and requires explicit legacy adaptation', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-interactions--missing-native-reader&viewMode=story');
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill(JSON.stringify(interactionExample));
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'beads-changeset · unsupported', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4 })).toHaveCount(4);
  const item = structuredClone(interactionExample.interactions[0]);
  if (item.kind !== 'content-comment' || !item.context.target.resource) throw new Error('Invalid fixture');
  const { revisionKind, ...resource } = item.context.target.resource;
  const legacy = { schemaVersion: 1, batchId: interactionExample.batchId, exportedAt: interactionExample.exportedAt, interactions: [{ ...item, context: { ...item.context, target: { ...item.context.target, resource: { ...resource, repository: 'example/storage', workspace: 'demo' } } } }] };
  await page.getByLabel('Interaction batch JSON', { exact: true }).fill(JSON.stringify(legacy));
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('explicit producer adapter');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Validate and preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Resolved for review — no effects applied', exact: true })).toBeVisible();
});

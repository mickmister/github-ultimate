import { expect, test } from '@playwright/test';
import type { ReviewFixtureState } from '../../webapp/stories/reviews.fixtures';

const orientations = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 900, 1440], ['desktop', 'landscape', 1440, 900],
] as const;

for (const [surface, orientation, width, height] of orientations) {
  for (const region of ['inbox', 'detail']) {
    test(`${region} production ${surface} ${orientation}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/iframe.html?id=web-app-reviews-${region}-surfaces--${surface}-${orientation}&viewMode=story`);
      const presentation = page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`);
      await expect(presentation).toBeVisible({ timeout: 90000 });
      if (region === 'inbox') {
        await expect(page.getByRole('link', { name: 'Reader follow-up', exact: true })).toBeVisible();
        if (surface === 'phone') await page.getByText('Source and filters', { exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveValue('reader-workspace');
      } else {
        await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
        const content = (await page.locator('.review-content').boundingBox())!;
        const navigator = (await page.locator('.review-navigator').boundingBox())!;
        if (surface === 'phone') expect(content.y).toBeGreaterThan(navigator.y);
        else expect(content.x).toBeGreaterThan(navigator.x);
        if (surface === 'desktop') expect((await page.locator('.review-evidence').boundingBox())!.x).toBeGreaterThan(content.x);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('real review hosts preserve draft, question step, Zen, progress, comparison and comments across all surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-reviews-detail-surfaces--adaptive&viewMode=story');
  await page.getByRole('button', { name: 'Baseline', exact: true }).click();
  const contentHost = page.locator('.review-content');
  await contentHost.evaluate(node => { node.setAttribute('data-lifetime', 'stable'); });
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    await expect(contentHost).toHaveAttribute('data-lifetime', 'stable');
    await expect(page.getByRole('button', { name: 'Baseline', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Full document', exact: true }).click();
  await page.getByText('I have reviewed this item', { exact: true }).click();
  await page.getByText('The full target document is pinned to this packet.').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  await page.getByRole('dialog', { name: 'Comment on Content', exact: true }).getByLabel('Your comment').fill('Keep this comment through rotation.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await page.getByText('Add note about Keep this approach', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true }).fill('Keep my choice note.');
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep my question and answer.');
  await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
  for (const [surface, orientation, width, height] of orientations) {
    await page.getByRole('heading', { name: 'Additional notes', exact: true }).focus();
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`)).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Reader decisions — Zen mode', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep my question and answer.');
  }
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep this approach', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Notes for Keep this approach', exact: true })).toHaveValue('Keep my choice note.');
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByRole('button', { name: 'Reader plan', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'I have reviewed this item', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await expect(page.getByLabel('Comment 1', { exact: true })).toHaveValue('Keep this comment through rotation.');
});

test('inbox source selections and filters survive presentation swaps without member reads', async ({ page }) => {
  let reads = 0;
  await page.route('**/__review-fixture', route => {
    if (route.request().headers()['x-review-resource']) reads++;
    return route.fulfill({ json: { artifacts: [], revision: 1 } });
  });
  await page.goto('/iframe.html?id=web-app-reviews-inbox-surfaces--adaptive&viewMode=story&remoteFixture=true');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('checkbox', { name: 'Only waiting for my response', exact: true }).uncheck();
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    if (surface === 'phone' && !await page.getByRole('combobox', { name: 'Workspace', exact: true }).isVisible()) await page.getByText('Source and filters', { exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Storage repository', exact: true })).toHaveValue('example/storage');
    await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveValue('reader-workspace');
    await expect(page.getByRole('checkbox', { name: 'Only waiting for my response', exact: true })).not.toBeChecked();
  }
  expect(reads).toBe(0);
});

test('uncertain response write keeps its immutable identity across presentation swaps and polling does not restart', async ({ page }) => {
  let state: ReviewFixtureState = { artifacts: [], revision: 1, workflow: { state: 'running', checked_at: '2026-11-20T00:00:00Z' } };
  let writes = 0, polls = 0;
  await page.route('**/__review-fixture', async route => {
    if (route.request().headers()['x-review-operation'] === 'progress') polls++;
    if (route.request().method() === 'POST') {
      writes++;
      state = route.request().postDataJSON();
      return route.abort('connectionreset'); // The immutable response was stored, but the reply was lost.
    }
    return route.fulfill({ json: state });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-reviews-detail-surfaces--adaptive&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  while (await page.getByRole('button', { name: 'Next question', exact: true }).count()) await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const saved = state.artifacts[0];
  expect(saved.value.request).toEqual({ id: 'reader-01', version: 'e'.repeat(40), snapshot: '1'.repeat(40) });
  expect(saved.value.forms[0].dsl.version).toBe('c'.repeat(40));
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit just this form', exact: true })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Submit just this form', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  expect(state.artifacts).toHaveLength(1);
  expect(state.artifacts[0].value.id).toBe(saved.value.id);
  expect(writes).toBe(1);
  await expect.poll(() => polls).toBe(1);
  const workflow = page.locator('[data-ui="review-workflow-progress"]');
  await workflow.evaluate(node => node.setAttribute('data-lifetime', 'stable'));
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-review-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    await expect(workflow).toHaveAttribute('data-lifetime', 'stable');
  }
  expect(polls).toBe(1);
});

test('access revocation removes the restored packet and its content', async ({ page }) => {
  let revoked = false;
  await page.route('**/__review-fixture', route => revoked
    ? route.fulfill({ status: 403, body: 'Access denied' })
    : route.fulfill({ json: { artifacts: [], revision: 1 } }));
  await page.goto('/iframe.html?id=web-app-reviews-detail-surfaces--adaptive&viewMode=story&remoteFixture=true');
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
  revoked = true;
  await page.getByRole('button', { name: 'Check for updates and receipts', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 403');
  await expect(page.getByRole('region', { name: 'Focused review session', exact: true })).toHaveCount(0);
  await expect(page.getByText('The full target document is pinned to this packet.')).toHaveCount(0);
});

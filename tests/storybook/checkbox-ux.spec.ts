import { test, expect } from '@playwright/test';

test('checkbox rows offer large labels, native keyboard controls, and independent comments', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--pending&viewMode=story');
  const question = page.getByRole('group', { name: 'What kind of change should we make?', exact: true });
  await expect(question).toHaveAccessibleDescription('Select all that apply.');
  const checkbox = question.getByRole('checkbox', { name: 'A small focused change', exact: true });
  await expect(checkbox).toHaveAccessibleDescription(/Fix the immediate problem first\./);
  await expect(checkbox).not.toBeChecked();
  await expect(question.getByRole('checkbox', { name: 'A broader investigation', exact: true })).not.toBeChecked();
  const row = question.locator('.choice').filter({ has: page.getByRole('checkbox', { name: 'A small focused change', exact: true }) });
  const label = row.locator('label');
  await expect(label).toHaveText('A small focused change - Recommended');
  await expect(row).not.toContainText('Faster review and verification.');
  const target = (await label.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  const comment = row.getByRole('button', { name: 'Leave a comment about A small focused change', exact: true });
  const commentBox = (await comment.boundingBox())!;
  const contentBox = (await row.locator('.choice-content').boundingBox())!;
  expect(commentBox.y).toBeGreaterThanOrEqual(contentBox.y + contentBox.height);
  const tradeoffs = await row.locator('.choice-tradeoffs .markdown').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  expect(tradeoffs).toHaveLength(2);
  expect(Math.abs(tradeoffs[0] - tradeoffs[1])).toBeLessThanOrEqual(1);
  const assumption = question.locator('.choice').filter({ has: page.getByRole('checkbox', { name: 'A broader investigation', exact: true }) });
  await expect(assumption.locator('.badge')).toHaveCount(0);
  await expect(assumption.locator('.choice-content p')).toHaveText('Explore the surrounding behavior before choosing a fix. The author assumes this applies; it is not preselected.');
  await label.click({ position: { x: target.width - 12, y: target.height / 2 } });
  await expect(checkbox).toBeChecked();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).not.toBeChecked();
  await comment.click();
  await row.getByRole('textbox').fill('Keep this comment even if I do not select the option.');
  expect((await row.getByRole('textbox').boundingBox())!.width).toBeGreaterThan((await row.boundingBox())!.width * 0.8);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await question.getByRole('checkbox', { name: 'A broader investigation', exact: true }).check();
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'A small focused change', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Add note about A small focused change', exact: true })).toHaveValue('Keep this comment even if I do not select the option.');
});

test('named choice groups preserve multiple selections and the Other follow-up', async ({ page }) => {
  await page.goto('/iframe.html?id=corner-cases--grouped-choices-and-comments&viewMode=story');
  const rollout = page.getByRole('group', { name: 'Suggested rollout', exact: true });
  await expect(rollout.getByRole('checkbox', { name: 'Incremental rollout', exact: true })).toBeChecked();
  await expect(rollout.getByRole('checkbox', { name: 'Replace everything', exact: true })).toBeChecked();
  await expect(page.getByRole('group', { name: 'Supporting work', exact: true }).getByRole('checkbox', { name: 'Add monitoring', exact: true })).toBeChecked();
  const other = page.getByRole('checkbox', { name: 'Other', exact: true });
  await other.uncheck();
  await other.check();
  await expect(page.getByRole('textbox', { name: 'Add note about Other', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Add note about Other', exact: true }).fill('A different rollout, with monitoring.');
  await page.locator('.question-index').getByRole('button', { name: 'Review answers', exact: true }).click();
  await expect(page.locator('.answer-review')).toContainText('A different rollout, with monitoring.');
  await expect(page.locator('.answer-review')).toContainText('Incremental rollout, Replace everything');
});

test('long checkbox labels and fifty choices fit a dark phone layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=corner-cases--fifty-choices&viewMode=story&args=theme:dark');
  await expect(page.getByRole('checkbox')).toHaveCount(51);
  const sizes = await page.locator('.choice-label').evaluateAll(nodes => nodes.map(node => ({
    height: node.getBoundingClientRect().height, width: node.clientWidth, scrollWidth: node.scrollWidth,
  })));
  for (const size of sizes) {
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  }
  expect(await page.locator('[data-story-renderer]').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const last = page.getByRole('checkbox', { name: 'Target 50: verify compatibility with this deployment environment', exact: true });
  await last.check();
  await expect(last).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Target 1: verify compatibility with this deployment environment', exact: true })).not.toBeChecked();
});

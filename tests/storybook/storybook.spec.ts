import { test, expect } from '@playwright/test';

test('every indexed story renders the shipping UI or its intentional native fallback', async ({ page, request }) => {
  const index = await (await request.get('/index.json')).json();
  const entries = Object.values(index.entries) as { id: string; type: string }[];
  const stories = entries.filter(entry => entry.type === 'story');
  expect(stories.length).toBeGreaterThanOrEqual(40);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const story of stories) {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    await expect(page.locator('[data-story-renderer]')).toBeVisible();
    await expect(page.locator('[data-story-renderer]').locator('.form-card, .snapshot, [role="alert"]')).not.toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('Other, independent selections, preview, native draft and simulated history form a complete local loop', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--pending&viewMode=story');
  await page.getByRole('checkbox', { name: 'A small focused change', exact: true }).check();
  await page.getByRole('checkbox', { name: 'A broader investigation', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'A small focused change', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Other', exact: true }).check();
  await page.getByRole('textbox', { name: 'Add note about Other', exact: true }).fill('Combine the approaches.');
  await page.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  await page.getByRole('textbox', { name: 'What context matters?', exact: true }).fill('m stays text.');
  await page.getByRole('button', { name: 'Review answers', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Generated comment preview' })).toHaveValue(/Combine the approaches/);
  await page.getByRole('button', { name: 'Place in GitHub comment editor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Local GitHub comment editor', exact: true })).toHaveValue(/^My existing native comment draft\.\n\n\/github-ultimate discuss/);
  await expect(page.getByRole('button', { name: 'View submitted answers', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Simulate posting locally', exact: true }).click();
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  await expect(page.locator('.saved-answers')).toContainText('Combine the approaches.');
  await expect(page.getByRole('status').filter({ hasText: 'Nothing was sent to GitHub' })).toBeVisible();
});

test('submitted history is read-only and a new response starts empty', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--submission-history&viewMode=story');
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  await expect(page.locator('.saved-answers h3')).toHaveCount(2);
  await expect(page.locator('.saved-answers').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit another response', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'A small focused change', exact: true })).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
});

test('phone and zen keep seeded values while raw invalid records and unsafe markdown stay inert', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=forms--dark-phone&viewMode=story');
  await page.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What context matters?', exact: true });
  const value = await input.inputValue();
  await page.getByRole('button', { name: 'Open in zen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(input).toHaveValue(value);
  await page.getByRole('button', { name: 'Close zen', exact: true }).click();
  await expect(input).toHaveValue(value);
  await page.goto('/iframe.html?id=fallbacks--unsupported-field&viewMode=story');
  await expect(page.getByRole('alert')).toContainText('Invalid record');
  await expect(page.locator('[data-story-renderer] pre')).toContainText('untrusted-action.yml');
  await page.goto('/iframe.html?id=fallbacks--unsafe-markdown&viewMode=story');
  await expect(page.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
  await page.getByText('Context', { exact: true }).click();
  await expect(page.locator('.markdown img, .markdown script, .markdown a[href^="javascript:"]')).toHaveCount(0);
});

test('Storybook manager opens a navigable story canvas', async ({ page }) => {
  await page.goto('/?path=/story/forms--pending');
  await expect(page.locator('#storybook-preview-iframe')).toBeVisible();
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
});

import { test, expect } from '@playwright/test';

for (const zen of [false, true]) {
  test(`Finalize reveals and emphasizes submission choices without submitting (${zen ? 'zen' : 'inline'})`, async ({ page }) => {
    await page.goto('/iframe.html?id=corner-cases--thirty-questions-review&viewMode=story');
    if (zen) await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
    const form = zen ? page.getByRole('dialog') : page.locator('[data-story-renderer]');
    const finalize = form.getByRole('button', { name: 'Finalize', exact: true });
    await expect(finalize).toHaveCount(2);
    await expect(form.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    const choices = form.getByRole('group', { name: 'Choose how to continue', exact: true });
    await expect(choices).not.toBeInViewport();
    await finalize.first().focus();
    await finalize.first().press('Enter');
    await expect(choices).toBeInViewport({ ratio: 1 });
    await expect(choices).toBeFocused();
    await expect(choices).toHaveClass(/is-ready/);
    await expect(choices.getByRole('button')).toHaveCount(2);
    await expect(choices.getByRole('button').first()).toHaveCSS('animation-name', 'submission-ready');
    await expect(form.locator('.preview')).toBeHidden();
    await expect(page.locator('.gh-posted-timeline')).toBeEmpty();
    await page.keyboard.press('Tab');
    await expect(choices.getByRole('button', { name: 'Approved for next steps', exact: true })).toBeFocused();
    await choices.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
    await expect(form.getByRole('textbox', { name: 'Generated comment preview' })).toHaveValue(/\/github-ultimate discuss/);
  });
}

test('phone Finalize respects reduced motion and discussion-only forms', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/iframe.html?id=forms--discussion-only&viewMode=story');
  const choices = page.getByRole('group', { name: 'Choose how to continue', exact: true });
  await page.getByRole('button', { name: 'Finalize', exact: true }).last().click();
  await expect(choices).toBeInViewport({ ratio: 1 });
  await expect(choices).toBeFocused();
  await expect(choices.getByRole('button')).toHaveCount(1);
  await expect(choices.getByRole('button')).toHaveCSS('animation-name', 'none');
  await expect(choices).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.preview')).toBeHidden();
  await page.locator('.wizard-header').getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toHaveCount(0);
  await expect(page.locator('.wizard-header .wizard-navigation').getByRole('button', { name: 'Review answers', exact: true })).toBeVisible();
});

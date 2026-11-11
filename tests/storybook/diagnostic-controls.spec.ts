import { test, expect } from '@playwright/test';

test('original record button defaults off and follows the Storybook setting control', async ({ page }) => {
  await page.goto('/?path=/story/forms--pending');
  await expect(page.locator('#storybook-preview-iframe')).toBeVisible();
  const canvas = page.frameLocator('#storybook-preview-iframe');
  const button = canvas.getByRole('button', { name: 'Show / hide original record', exact: true });
  await expect(canvas.getByRole('heading', { name: 'Plan the next change', exact: true })).toBeVisible();
  await expect(button).toHaveCount(0);
  await page.getByRole('tab', { name: /Controls/ }).click();
  const setting = page.getByRole('row').filter({ hasText: 'Show original record button' }).getByRole('switch');
  await expect(setting).not.toBeChecked();
  await setting.press('Space');
  await expect(button).toBeVisible();
  await button.click();
  await expect(canvas.locator('.gh-source-data')).toBeVisible();
  await setting.press('Space');
  await expect(button).toHaveCount(0);
  await expect(canvas.locator('.gh-source-data')).toBeHidden();
});

test('Zen story uses the same off-by-default diagnostic setting', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--zen&viewMode=story');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Show / hide original record', exact: true })).toHaveCount(0);
  await page.goto('/iframe.html?id=forms--zen&viewMode=story&args=showDiagnosticJson:true');
  await expect(dialog.getByRole('button', { name: 'Show / hide original record', exact: true })).toBeVisible();
});

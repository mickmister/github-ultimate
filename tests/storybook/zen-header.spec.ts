import { test, expect } from '@playwright/test';

test('Zen story shares the responsive header without scroll-container gutters', async ({ page }) => {
  await page.goto('/iframe.html?id=forms--zen&viewMode=story');
  const dialog = page.getByRole('dialog', { name: 'Plan the next change' });
  await expect(dialog).toBeVisible();
  const header = dialog.locator('.wizard-header');
  const index = header.getByRole('navigation', { name: 'Form questions' });
  await expect(index.getByRole('button')).toHaveCount(4);
  await header.evaluate(node => {
    (node.parentElement!.querySelector('fieldset:not([hidden])') as HTMLElement).style.minHeight = '1800px';
    const body = node.closest('.zen-body')!;
    body.scrollTop += node.getBoundingClientRect().top - body.getBoundingClientRect().top + 200;
  });
  await expect.poll(async () => header.evaluate(node => {
    const body = node.closest('.zen-body')!;
    return Math.abs(node.getBoundingClientRect().top - body.getBoundingClientRect().top);
  })).toBeLessThanOrEqual(1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => header.evaluate(node => {
      const body = node.closest('.zen-body')!;
      const box = node.getBoundingClientRect(), scrollBox = body.getBoundingClientRect();
      return Math.max(Math.abs(box.left - scrollBox.left), Math.abs(box.width - body.clientWidth));
    })).toBeLessThanOrEqual(1);
    await expect(index).toBeVisible();
    const active = index.locator('[aria-current=step]');
    await expect(active).toHaveCSS('font-size', '18px');
    await expect(active).toHaveCSS('white-space', 'normal');
    expect(await index.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await index.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  await expect(header.locator('.wizard-progress')).toHaveText('Question 2 of 3');
  await expect(dialog.getByRole('textbox', { name: 'What context matters?', exact: true })).toHaveValue(/two browsers/);
  await dialog.getByRole('button', { name: 'Close zen', exact: true }).click();
  await expect(dialog).toBeHidden();
});

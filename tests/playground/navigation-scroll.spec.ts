import { test, expect } from '@playwright/test';

for (const zen of [false, true]) {
  test(`tab navigation only resets scroll after the header sticks (${zen ? 'zen' : 'inline'})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: /Question wizard/ }).click();
    if (zen) await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
    const header = page.locator('#renderer .wizard-header');
    const anchor = page.locator('#renderer .wizard-anchor');
    const tabs = header.locator('.question-index button');
    // Equal tall questions keep browser scroll clamping out of these assertions.
    await header.evaluate(node => {
      for (const field of node.parentElement!.querySelectorAll<HTMLElement>('fieldset')) field.style.minHeight = '1800px';
    });
    const scrollPosition = () => header.evaluate(node => node.closest('.zen-body')?.scrollTop ?? window.scrollY);

    await anchor.evaluate(node => {
      const scroller = node.closest('.zen-body');
      if (scroller) scroller.scrollTop = 0;
      else window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 250);
    });
    const above = await scrollPosition();
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'step');
    expect(Math.abs(await scrollPosition() - above)).toBeLessThanOrEqual(1);

    await anchor.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const atHeader = await scrollPosition();
    await tabs.nth(0).click();
    expect(Math.abs(await scrollPosition() - atHeader)).toBeLessThanOrEqual(1);

    await header.evaluate(node => {
      const scroller = node.closest('.zen-body');
      if (scroller) scroller.scrollBy(0, 300); else window.scrollBy(0, 300);
    });
    const below = await scrollPosition();
    await tabs.nth(1).click();
    expect(await scrollPosition()).toBeLessThan(below - 200);
    expect(Math.abs(await scrollPosition() - atHeader)).toBeLessThanOrEqual(2);
  });
}

test('non-sticky phone navigation does not force a scroll reset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /Question wizard/ }).click();
  const header = page.locator('#renderer .wizard-header');
  await expect(header).toHaveCSS('position', 'static');
  await header.evaluate(node => {
    for (const field of node.parentElement!.querySelectorAll<HTMLElement>('fieldset')) field.style.minHeight = '1800px';
    node.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy(0, 300);
  });
  const before = await page.evaluate(() => window.scrollY);
  // Activate offscreen navigation without Playwright scrolling it into view first.
  await header.locator('.question-index button').nth(1).evaluate(node => (node as HTMLButtonElement).click());
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThanOrEqual(1);
});

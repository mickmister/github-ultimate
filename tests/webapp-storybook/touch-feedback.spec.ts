import { test, expect, type Locator } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function highlight(element: Locator, pointerType = 'touch') {
  await element.scrollIntoViewIfNeeded();
  await element.dispatchEvent('pointerdown', { pointerType });
  const text = await element.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  });
  await element.dispatchEvent('pointerup', { pointerType });
  return text;
}

test('touch highlighting offers a nearby action without stealing selection, using the nearest target', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-feedback--nested-targets&viewMode=story');
  const quote = await highlight(page.locator('.markdown-preview strong').first());
  const action = page.getByRole('button', { name: 'Comment on selection', exact: true });
  await expect(action).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => getSelection()!.toString())).toBe(quote);
  const bounds = (await action.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await action.tap();
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).tap();
  const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await expect(composer.locator('blockquote')).toHaveText(quote);
  await expect(composer).toContainText('planning/product-brief.md');
  await composer.getByLabel('Your comment').fill('This mobile selection keeps its exact document context.');
  await composer.getByRole('button', { name: 'Add to queue', exact: true }).tap();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('github-ultimate:feedback:v1')!));
  expect(stored.interactions[0].context.target.featureId).toBe('documents.markdown-renderer');
  expect(stored.interactions[0].context.selection.text).toBe(quote);
});

test('native handle adjustments settle before actions appear; clearing or outside selections hide them', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--reading-document&viewMode=story');
  const text = page.locator('.markdown-preview strong').first();
  await expect(text).toBeVisible({ timeout: 30000 });
  await text.scrollIntoViewIfNeeded();
  const nativeMenuPrevented = await text.evaluate(node => !node.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' })));
  expect(nativeMenuPrevented).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.clock.install();
  await text.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await text.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.clock.runFor(300);
  const action = page.getByRole('button', { name: 'Comment on selection', exact: true });
  await expect(action).toHaveCount(0);
  await text.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.clock.runFor(300);
  await expect(action).toBeVisible();
  await page.evaluate(() => { getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
  await page.clock.runFor(300);
  await expect(action).toHaveCount(0);
  await highlight(page.getByRole('heading', { name: 'planning/product-brief.md', exact: true }));
  await page.clock.runFor(300);
  await expect(action).toHaveCount(0);
});

for (const form of [false, true]) {
  test(`touch selection actions work inside ${form ? 'form' : 'document'} zen mode`, async ({ page }) => {
    await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
    if (form) await page.getByRole('button', { name: 'Reader decisions', exact: true }).tap();
    await page.getByRole('button', { name: 'Zen mode', exact: true }).tap();
    const zen = page.getByRole('dialog', { name: `${form ? 'Reader decisions' : 'Reader plan'} — Zen mode`, exact: true });
    const passage = form ? zen.locator('.review-choice p').first() : zen.locator('.markdown-preview p').first();
    const quote = await highlight(passage);
    const action = zen.getByRole('button', { name: 'Comment on selection', exact: true });
    await expect(action).toBeVisible();
    await action.tap();
    await zen.getByRole('menuitem', { name: 'Comment on Content', exact: true }).tap();
    const composer = zen.getByRole('dialog', { name: 'Comment on Content', exact: true });
    await expect(composer.locator('blockquote')).toHaveText(quote);
    await composer.getByLabel('Your comment').fill('Selected by touch in zen mode.');
    await composer.getByRole('button', { name: 'Add to queue', exact: true }).tap();
    await expect(zen.getByRole('button', { name: 'Comments · 1', exact: true })).toBeVisible();
    await zen.getByRole('button', { name: '← Back', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Comment on selection', exact: true })).toHaveCount(0);
  });
}

test('selected textarea text is captured while passwords are excluded', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-feedback--input-selections&viewMode=story');
  const answer = page.getByRole('textbox', { name: 'Example answer', exact: true });
  await answer.tap();
  await answer.evaluate(node => { (node as HTMLTextAreaElement).setSelectionRange(4, 18); document.dispatchEvent(new Event('selectionchange')); });
  const action = page.getByRole('button', { name: 'Comment on selection', exact: true });
  await expect(action).toBeVisible();
  await action.tap();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).tap();
  const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await expect(composer.locator('blockquote')).toHaveText('selected value');
  await composer.getByRole('button', { name: 'Close comments', exact: true }).tap();
  const password = page.getByLabel('Password', { exact: true });
  await password.tap();
  await page.clock.install();
  await password.evaluate(node => { (node as HTMLInputElement).setSelectionRange(0, 12); document.dispatchEvent(new Event('selectionchange')); });
  await page.clock.runFor(300);
  await expect(action).toHaveCount(0);
});

test.describe('desktop behavior', () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });
  test('ordinary mouse highlighting does not add a touch action', async ({ page }) => {
    await page.goto('/iframe.html?id=web-app-feedback--nested-targets&viewMode=story');
    const text = page.locator('.markdown-preview strong').first();
    await expect(text).toBeVisible({ timeout: 30000 });
    await page.clock.install();
    await highlight(text, 'mouse');
    await page.clock.runFor(300);
    await expect(page.getByRole('button', { name: 'Comment on selection', exact: true })).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';

async function selectText(page: Page, selector: string) {
  const element = page.locator(selector).first();
  const text = await element.innerText();
  await element.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await element.click({ button: 'right' });
  return text;
}

test('captures selected content, persists across reload, edits and copies a compact review before clearing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-document-browser--reading-document&viewMode=story');
  const quote = await selectText(page, '.markdown-preview strong');
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await expect(dialog.locator('blockquote')).toHaveText(quote);
  await dialog.getByLabel('Your comment').fill('Reword this introduction.');
  await dialog.getByRole('button', { name: 'Add to queue' }).click();
  await expect(page.getByRole('button', { name: 'Comments · 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('github-ultimate:feedback:v1')!))).not.toHaveProperty('interactions.0.context.pageUrl');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Queued comments', exact: true });
  await review.getByLabel('Comment 1', { exact: true }).fill('Make the introduction more concrete.');
  await review.getByRole('button', { name: 'Copy review & clear', exact: true }).click();
  await expect(review.getByText('No comments queued.', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('# planning/product-brief.md');
  expect(copied).toContain(`Revision: ${'a1b2c3d4'.repeat(5)}`);
  expect(copied).toContain(`> ${quote}\n\nMake the introduction more concrete.`);
  for (const omitted of ['pageUrl', 'schemaVersion', 'prefix', 'suffix', 'appBuild', 'featureId', 'capturedAt']) expect(copied).not.toContain(omitted);
});

test('another application can explicitly opt into URLs with an isolated draft key', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-feedback--url-opt-in&viewMode=story');
  const url = page.url();
  await page.getByRole('button', { name: 'Comment on planning/product-brief.md', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Feature', exact: true }).click();
  await page.getByLabel('Your comment').fill('This app opted into URL capture.');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('feedback:url-opt-in-demo:v1')!));
  expect(draft.interactions[0].context.pageUrl).toBe(url);
  expect(await page.evaluate(() => sessionStorage.getItem('github-ultimate:feedback:v1'))).toBeNull();
  await page.reload();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Copy review & clear', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No comments queued.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`Page: ${url}`);
});

test('nearest nested target owns the menu; ordinary Copy does not enqueue; failed export preserves feature comments', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-feedback--nested-targets&viewMode=story');
  const quote = await selectText(page, '.markdown-preview strong');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(quote);
  await expect(page.getByRole('button', { name: 'Comments · 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Comment on planning/product-brief.md', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Feature', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Comment on Feature', exact: true });
  await expect(composer).toContainText('documents.markdown-renderer');
  await composer.getByLabel('Your comment').fill('Improve paragraph spacing.');
  await composer.getByRole('button', { name: 'Add to queue' }).click();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } }));
  const review = page.getByRole('dialog', { name: 'Queued comments', exact: true });
  await review.getByRole('button', { name: 'Copy review & clear', exact: true }).click();
  await expect(review).toContainText('Your comments are still queued');
  await expect(review.getByLabel('Comment 1', { exact: true })).toHaveValue('Improve paragraph spacing.');
  await review.getByRole('button', { name: 'Remove comment 1', exact: true }).click();
  await expect(review).toContainText('No comments queued.');
});

test('source editor captures exact model selection and line ranges through its context boundary', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/iframe.html?id=web-app-document-browser--json-source&viewMode=story');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Read-only document source' }).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('.monaco-editor .view-lines').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await expect(composer.locator('blockquote')).toContainText('"readOnly": true');
  await composer.getByLabel('Your comment').fill('Explain this setting.');
  await composer.getByRole('button', { name: 'Add to queue' }).click();
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Copy review & clear', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Queued comments', exact: true })).toContainText('No comments queued.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('## 1 — lines 1–4');
  expect(copied).toContain('"readOnly": true');
  expect(copied).toContain('Explain this setting.');
});

test('row overflow and keyboard actions work without opening the document and fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/iframe.html?id=web-app-document-browser--filtered-documents&viewMode=story');
  await page.getByRole('button', { name: 'Comment on planning/notes.md', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comment on Content', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Comment on Content', exact: true });
  await expect(composer).toContainText('planning/notes.md');
  await composer.getByLabel('Your comment').fill('Keep this document with the research.');
  await composer.getByRole('button', { name: 'Add to queue' }).click();
  await expect(page.getByRole('tree')).toBeVisible();
  await expect(page.locator('.document-fullscreen')).toHaveCount(0);
  const item = page.getByRole('treeitem', { name: 'planning/notes.md', exact: true });
  await item.focus(); await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Comments · 1', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

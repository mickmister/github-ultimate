import { test, expect } from '@playwright/test';

test('interactive mock host runs the real document controller without extension or API requests', async ({ page }) => {
  const messages: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const send = window.postMessage.bind(window);
    window.postMessage = ((message: unknown, ...rest: unknown[]) => {
      if ((message as { channel?: string })?.channel === 'github-ultimate-page-v1') throw new Error('Story attempted to use the extension bridge.');
      return (send as (...args: unknown[]) => void)(message, ...rest);
    }) as typeof window.postMessage;
  });
  await page.route('https://api.github.com/**', route => { messages.push(route.request().url()); return route.abort(); });
  await page.goto('/iframe.html?id=web-app-document-browser--interactive&viewMode=story');
  await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeEnabled();
  await page.getByLabel('Storage repository').fill('octo-example/workspace-storage');
  await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('3 workspace(s) found');
  await page.getByLabel('Stored workspace').selectOption('product-research');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await page.getByRole('button', { name: 'planning/product-brief.md', exact: false }).click();
  await expect(page.getByLabel('Document content')).toContainText('deterministic Storybook fixture data');
  await page.getByLabel('Find a document').fill('literal-html');
  await page.getByRole('button', { name: 'examples/literal-html.txt', exact: false }).click();
  await expect(page.getByLabel('Document content')).toContainText('<script>');
  expect(await page.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  expect(messages).toEqual([]); expect(errors).toEqual([]);
});

test('presentation fixtures cover ready, loading, error, empty and long-content layouts', async ({ page }) => {
  for (const story of ['reading-document', 'loading', 'read-error', 'empty-workspace', 'no-connections', 'long-content']) {
    await page.goto(`/iframe.html?id=web-app-document-browser--${story}&viewMode=story`);
    await expect(page.getByRole('heading', { name: 'Workspace documents', exact: true })).toBeVisible();
    if (story === 'reading-document') await expect(page.getByLabel('Document content')).toContainText('Product brief');
    if (story === 'loading') await expect(page.getByRole('status')).toContainText('Reading and verifying');
    if (story === 'read-error') await expect(page.getByRole('alert')).toContainText('approved access route');
    if (story === 'empty-workspace') await expect(page.getByText('No documents match this search.')).toBeVisible();
    if (story === 'no-connections') await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

import { test, expect } from '@playwright/test';

test('Markdown renders Mermaid flowcharts and keeps source mode and ordinary code intact', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--mermaid-diagrams&viewMode=story');
  const preview = page.getByRole('region', { name: 'Markdown preview', exact: true });
  await expect(preview.getByRole('img', { name: 'Mermaid diagram' })).toHaveCount(2, { timeout: 20000 });
  await expect(preview.locator('svg').first()).toBeVisible();
  await expect(preview.locator('svg').first()).toContainText('Read snapshot');
  await expect(preview.locator('svg').first()).toContainText('Apply changeset');
  await expect(preview.locator('code.language-text')).toContainText('flowchart TD');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByLabel('Document content')).toContainText('```mermaid');
  await page.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  await expect(preview.getByRole('img', { name: 'Mermaid diagram' })).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid Mermaid preserves readable source and does not block later diagrams', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/iframe.html?id=web-app-document-browser--invalid-mermaid&viewMode=story');
  const preview = page.getByRole('region', { name: 'Markdown preview', exact: true });
  await expect(preview).toContainText('Unable to render Mermaid diagram', { timeout: 20000 });
  await expect(preview.locator('code.language-mermaid').first()).toContainText('A[Unclosed node');
  await expect(preview).toContainText('The rest of the document still renders.');
  await expect(preview.getByRole('img', { name: 'Mermaid diagram' })).toContainText('Still renders');
  expect(errors).toEqual([]);
});

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
  await page.getByRole('treeitem', { name: 'planning', exact: true }).click();
  await page.getByRole('treeitem', { name: 'planning/product-brief.md', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Markdown preview', exact: true });
  await expect(preview).toContainText('deterministic Storybook fixture data');
  await expect(page.locator('.document-fullscreen')).toBeVisible();
  const bounds = await page.getByRole('main').boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.y).toBe(0);
  expect(bounds?.width).toBe(page.viewportSize()!.width);
  expect(bounds!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height);
  await expect(page.getByRole('tree', { name: 'Documents' })).toHaveCount(0);
  await expect(preview.getByRole('heading', { name: 'Product brief', exact: true })).toBeVisible();
  await expect(preview.getByRole('table')).toBeVisible();
  await expect(preview.getByRole('checkbox').first()).toBeChecked();
  await expect(preview.getByRole('checkbox').first()).toBeDisabled();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Back to documents' }).click();
  await page.getByLabel('Find a document').fill('literal-html');
  await page.getByRole('treeitem', { name: 'examples/literal-html.txt', exact: true }).click();
  await expect(page.getByLabel('Document content')).toContainText('<script>');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Markdown preview', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  expect(messages).toEqual([]); expect(errors).toEqual([]);
});

test('rich Markdown strips active HTML and remote embeds', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://example.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/iframe.html?id=web-app-document-browser--untrusted-markdown&viewMode=story');
  const preview = page.getByRole('region', { name: 'Markdown preview', exact: true });
  await expect(preview).toContainText('Safe document text');
  await expect(preview.locator('script, img, iframe')).toHaveCount(0);
  await expect(preview.getByText('Unsafe link')).not.toHaveAttribute('href');
  expect(await page.evaluate(() => '__unsafeDocument' in window)).toBe(false);
  expect(requests).toEqual([]);
});

test('real controller supports keyboard tree browsing, ancestor-preserving search and persistent appearance', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--interactive&viewMode=story');
  await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
  await page.getByLabel('Stored workspace').selectOption('product-research');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  const research = page.getByRole('treeitem', { name: 'research', exact: true });
  await page.getByRole('button', { name: 'research', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(research).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'interviews', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const nested = page.getByRole('treeitem', { name: 'research/interviews/notes.md', exact: true });
  await expect(nested).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Select a document', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Markdown preview', exact: true })).toContainText('Nested research notes');
  await expect(page.getByRole('button', { name: 'Back to documents' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nested).toHaveAttribute('aria-selected', 'true');
  await expect(nested).toBeFocused();
  await page.getByLabel('Find a document').fill('notes.md');
  await expect(page.getByRole('treeitem', { name: 'planning/notes.md', exact: true })).toBeVisible();
  await expect(nested).toBeVisible();
  await page.getByLabel('Find a document').fill('');
  await expect(page.getByRole('treeitem', { name: 'planning', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(nested).toBeVisible();
  await page.getByText('Tree appearance', { exact: true }).click();
  await page.getByLabel('Tree density').selectOption('compact');
  await page.getByLabel('Tree accent').selectOption('teal');
  await expect(page.locator('.document-tree')).toHaveAttribute('data-density', 'compact');
  await page.reload();
  await page.getByRole('button', { name: 'Discover workspaces', exact: true }).click();
  await page.getByLabel('Stored workspace').selectOption('product-research');
  await page.getByRole('button', { name: 'Browse documents', exact: true }).click();
  await expect(page.locator('.document-tree')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('.document-tree')).toHaveAttribute('data-accent', 'teal');
});

test('nested tree uses full-path names and supports CSS customization and narrow layouts', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-document-browser--filtered-documents&viewMode=story');
  await expect(page.getByRole('treeitem', { name: 'planning/notes.md', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'research/interviews/notes.md', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '.document-tree { --document-tree-indent: 24px; --document-tree-row-height: 56px; --document-tree-accent: rgb(120, 40, 90); }' });
  const row = page.getByRole('treeitem', { name: 'planning/notes.md', exact: true });
  expect(await row.evaluate(element => getComputedStyle(element).minHeight)).toBe('56px');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Monaco JSON source is read-only, uses a local worker and supports find', async ({ page }) => {
  const errors: string[] = [], workers: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto('/iframe.html?id=web-app-document-browser--json-source&viewMode=story');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 20000 });
  const editor = page.getByRole('textbox', { name: 'Read-only document source' });
  const lines = page.locator('.monaco-editor .view-lines');
  const original = await lines.innerText();
  await editor.focus();
  await page.keyboard.insertText('MUTATED');
  await expect.poll(() => lines.innerText()).toBe(original);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByRole('textbox', { name: 'Find', exact: true })).toBeVisible();
  await expect.poll(() => workers.some(url => url.includes('json.worker'))).toBe(true);
  expect(workers.every(url => url.startsWith(new URL(page.url()).origin))).toBe(true);
  expect(errors).toEqual([]);
});

test('presentation fixtures cover ready, loading, error, empty and long-content layouts', async ({ page }) => {
  for (const story of ['reading-document', 'loading', 'read-error', 'empty-workspace', 'no-connections', 'long-content']) {
    await page.goto(`/iframe.html?id=web-app-document-browser--${story}&viewMode=story`);
    await expect(page.getByRole('main')).toBeVisible();
    if (story === 'reading-document') {
      await expect(page.getByRole('region', { name: 'Markdown preview', exact: true })).toContainText('Product brief');
      await expect(page.getByRole('button', { name: 'Back to documents' })).toBeVisible();
    }
    if (story === 'loading') await expect(page.getByRole('status').first()).toContainText('Reading and verifying');
    if (story === 'read-error') await expect(page.getByRole('alert')).toContainText('approved access route');
    if (story === 'empty-workspace') await expect(page.getByText('No documents match this search.')).toBeVisible();
    if (story === 'no-connections') await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

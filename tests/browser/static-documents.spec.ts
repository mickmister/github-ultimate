import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

test('staged Pages subpath loads compressed diagrams, source editor and JSON language modules', async ({ page }) => {
  test.setTimeout(90000);
  const root = resolve('hosted-dist'), base = '/preview/';
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://local.test').pathname;
    const file = resolve(root, path.slice(base.length) || 'index.html');
    if (!path.startsWith(base) || !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
    try { response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}${base}storybook/`;
  const errors: string[] = [], compressed: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('.gz') && response.ok()) compressed.push(response.url()); });
  try {
    await page.goto(origin + 'iframe.html?id=web-app-document-browser--mermaid-diagrams&viewMode=story');
    await expect(page.getByRole('img', { name: 'Mermaid diagram' })).toHaveCount(2, { timeout: 30000 });
    await expect(page.locator('.markdown-diagram').first()).toContainText('Read snapshot');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Document content')).toContainText('```mermaid');
    await page.goto(origin + 'iframe.html?id=web-app-document-browser--json-source&viewMode=story');
    await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => compressed.some(url => /jsonMode-.*\.js\.gz$/.test(url))).toBe(true);
    expect(compressed.some(url => /monaco-runtime-.*\.js\.gz$/.test(url))).toBe(true);
    expect(compressed.some(url => /mermaid\.tiny\.js-.*\.gz$/.test(url))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

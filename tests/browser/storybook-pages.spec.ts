import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

test('published Storybook loads its manager, stories and Monaco workers under a branch subdirectory', async ({ page }) => {
  test.setTimeout(60000);
  const base = 'https://pages.example/github-ultimate/previews/test-branch/storybook/';
  const errors: string[] = [], workers: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.route('https://pages.example/**', async route => {
    const url = new URL(route.request().url());
    if (!url.href.startsWith(base)) return route.fulfill({ status: 404 });
    const name = decodeURIComponent(url.pathname.slice(new URL(base).pathname.length)) || 'index.html';
    const root = resolve('hosted-dist/storybook'), path = resolve(root, name);
    if (!path.startsWith(root + sep)) return route.fulfill({ status: 404 });
    const mime = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.ttf') ? 'font/ttf' : 'text/html';
    try { return await route.fulfill({ body: await readFile(path), contentType: mime }); }
    catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(base + '?path=/story/web-app-document-browser--reading-document');
  const frame = page.frameLocator('#storybook-preview-iframe');
  await expect(frame.getByRole('heading', { name: 'planning/product-brief.md', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(frame.getByRole('region', { name: 'Markdown preview', exact: true }).getByRole('table')).toBeVisible();
  await expect(frame.getByRole('tree')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(frame.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 20000 });
  await frame.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'Markdown preview', exact: true }).getByRole('table')).toBeVisible();
  await frame.getByRole('button', { name: 'Back to documents' }).click();
  await expect(frame.getByRole('tree', { name: 'Documents' })).toBeVisible();
  await page.goto(base + 'iframe.html?id=web-app-document-browser--json-source&viewMode=story');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => workers.some(url => url.includes('json.worker'))).toBe(true);
  expect(workers.every(url => url.startsWith(base))).toBe(true);
  const metadata = await page.evaluate(async () => {
    const response = await fetch('./build.json');
    if (!response.ok) throw new Error('Missing Storybook build metadata.');
    return response.json();
  });
  expect(metadata).toEqual(JSON.parse(await readFile('hosted-dist/build.json', 'utf8')));
  expect(errors).toEqual([]);
});

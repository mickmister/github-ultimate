import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Start shell hydrates from static branch assets and reports a missing extension', async ({ page }) => {
  const shell = await readFile('hosted-dist/app/index.html', 'utf8');
  const appPath = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://mickmister.github.io/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith(appPath)) return route.fulfill({ status: 404 });
    const name = path.slice(appPath.length) || 'index.html';
    if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) return route.fulfill({ status: 404 });
    return route.fulfill({ path: resolve('hosted-dist/app', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto('https://mickmister.github.io' + appPath);
  await expect(page.getByRole('heading', { name: 'Workspace documents', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No bridge response', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

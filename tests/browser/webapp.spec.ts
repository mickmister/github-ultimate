import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Start shell hydrates from static branch assets and reports a missing extension', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const shell = await readFile('hosted-dist/app/index.html', 'utf8');
  const appPath = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://mickmister.github.io/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith(appPath)) return route.fulfill({ status: 404 });
    const name = path.slice(appPath.length) || 'index.html';
    if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf)$/.test(name)) return route.fulfill({ status: 404 });
    return route.fulfill({ path: resolve('hosted-dist/app', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
  });
  await page.goto('https://mickmister.github.io' + appPath);
  await expect(page.getByRole('heading', { name: 'Reviews Home', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await page.locator('.app-settings summary').click();
  const metadata = JSON.parse(await readFile('hosted-dist/build.json', 'utf8'));
  await expect(page.locator('.app-settings code')).toHaveText(metadata.sha);
  await expect(page.getByRole('link', { name: 'Inspect approved connections and storage', exact: true })).toHaveAttribute('href', '../settings.html');
  await page.goto('https://mickmister.github.io' + appPath + '#/documents');
  await expect(page.getByRole('heading', { name: 'Documents', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No bridge response', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Discover workspaces', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

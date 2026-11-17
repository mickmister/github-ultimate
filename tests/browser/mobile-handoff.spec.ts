import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveAlohakLink } from '../../src/mobile-protocol';

for (const [name, userAgent, visible] of [
  ['iPhone browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true],
  ['Android browser', 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36', true],
  ['inside Alohak', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Alohak/1', false],
  ['desktop browser', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0', false],
] as const) {
  test.describe(name, () => {
    test.use({ userAgent, viewport: { width: 390, height: 844 } });
    test('HTTPS chat links offer an exact-route app handoff only in mobile browsers', async ({ page }) => {
      const shell = await readFile('hosted-dist/app/index.html', 'utf8');
      const appPath = shell.match(/href="([^"]+)assets\/[^" ]+\.css"/)![1];
      const entry = `https://mickmister.github.io${appPath}`;
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://mickmister.github.io/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith(appPath)) return route.fulfill({ status: 404 });
        const name = path.slice(appPath.length) || 'index.html';
        if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|ttf)$/.test(name)) return route.fulfill({ status: 404 });
        return route.fulfill({ path: resolve('hosted-dist/app', name), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
      });
      const review = `${entry}?source=chat#/reviews/example?repository=mickmister%2Fworkspace-storage&workspace=workspace&version=${'a'.repeat(40)}&snapshot=${'b'.repeat(40)}`;
      await page.goto(review);
      const open = page.getByRole('link', { name: 'Open in Alohak', exact: true });
      if (visible) {
        await expect(open).toBeVisible();
        expect(resolveAlohakLink((await open.getAttribute('href'))!, entry)).toBe(review);
        await page.getByText('First-time setup', { exact: true }).click();
        await expect(page.locator('.mobile-handoff code')).toHaveText(entry);
        // Avoid launching an external application on the test runner, while
        // still exercising the real user-gesture handler and fallback message.
        await open.evaluate(anchor => anchor.addEventListener('click', event => event.preventDefault()));
        await open.click();
        await expect(page.locator('.mobile-handoff [role="status"]')).toContainText('Opening Alohak requested');
        const document = `${entry}?source=chat#/documents/${encodeURIComponent('c'.repeat(40) + ':documents/threads/task/test.md')}?repository=mickmister%2Fworkspace-storage&workspace=workspace`;
        await page.evaluate(url => { location.href = url; }, document);
        await expect(open).toHaveAttribute('href', /documents%252Fthreads/);
        expect(resolveAlohakLink((await open.getAttribute('href'))!, entry)).toBe(document);
      } else {
        await expect(page.getByText('Settings', { exact: true })).toBeVisible();
        await expect(open).toHaveCount(0);
      }
      expect(errors).toEqual([]);
    });
  });
}

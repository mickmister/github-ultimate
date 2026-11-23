import { expect, test, type Locator } from '@playwright/test';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function expectCenteredLoader(loader: Locator) {
  await expect(loader).toBeVisible({ timeout: 30000 });
  const indicator = loader.locator('.loading-indicator-spinner');
  const box = (await loader.boundingBox())!, spinner = (await indicator.boundingBox())!;
  expect(spinner.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(160);
  expect(Math.abs(spinner.x + spinner.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  // The spinner and its caption are centered vertically as one group.
  const caption = (await loader.locator('span').last().boundingBox())!;
  const layoutHeight = await indicator.evaluate(element => (element as HTMLElement).offsetHeight);
  const spinnerTop = spinner.y + spinner.height / 2 - layoutHeight / 2;
  expect(Math.abs((spinnerTop + caption.y + caption.height) / 2 - box.y - box.height / 2)).toBeLessThan(2);
}

for (const [surface, orientation, width, height] of [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 900, 1440], ['desktop', 'landscape', 1440, 900],
] as const) {
  test(`centered loading replaces transient review filters and document text on ${surface} ${orientation}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const detail of [true, false]) {
      const connection = gate(), request = gate(), contents = gate(), listing = gate();
      let refresh: ReturnType<typeof gate> | undefined;
      let opening = false;
      await page.route('**/__review-connect-fixture', async route => {
        await connection.promise;
        await route.fulfill({ json: {} });
      });
      await page.route('**/__review-fixture', async route => {
        const headers = route.request().headers();
        if (headers['x-review-operation'] === 'open') { opening = true; await request.promise; }
        if (headers['x-review-operation'] === 'list') { await listing.promise; await refresh?.promise; }
        if (headers['x-review-resource']) await contents.promise;
        await route.fulfill({ json: { artifacts: [], revision: 1 } });
      });
      try {
        const pin = new URLSearchParams({ repository: 'example/storage', workspace: 'reader-workspace', version: 'e'.repeat(40), snapshot: '1'.repeat(40) });
        await page.goto(`/iframe.html?id=web-app-reviews--${detail ? 'focused' : 'inbox'}&viewMode=story&remoteFixture=true&deferConnection=true${detail ? `#/reviews/reader-01?${pin}` : ''}`);
        const loader = page.getByRole('status', { name: 'Loading review requests…', exact: true });
        await expectCenteredLoader(loader);
        await expect(page.locator('[data-review-surface]')).toHaveCount(0);
        await expect(page.getByRole('combobox', { name: 'Queue filter', exact: true })).toHaveCount(0);
        connection.release();
        if (detail) {
          await expect.poll(() => opening).toBe(true);
          await expectCenteredLoader(loader);
          request.release();
          const memberLoader = page.getByRole('status', { name: 'Loading Reader plan…', exact: true });
          await expectCenteredLoader(memberLoader);
          await expect(page.getByRole('combobox', { name: 'Queue filter', exact: true })).toHaveCount(0);
          contents.release();
          // Reading is not held behind restoration of drafts/receipts.
          await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
          await expect(page.getByRole('region', { name: 'Pinned review preview', exact: true })).toBeVisible();
          await expect(memberLoader).toHaveCount(0);
          listing.release();
          await expect(page.getByRole('region', { name: 'Focused review session', exact: true })).toBeVisible();
          await expect(page.getByRole('combobox', { name: 'Queue filter', exact: true })).toHaveCount(0);
        } else {
          listing.release();
          if (surface === 'phone') await page.getByText('Source and filters', { exact: true }).click();
          const filter = page.getByRole('combobox', { name: 'Queue filter', exact: true });
          await expect(filter).toHaveValue('active');
          await expect(filter).toBeEnabled();
          const size = (await filter.boundingBox())!;
          expect(size.width).toBeGreaterThanOrEqual(24); expect(size.height).toBeGreaterThanOrEqual(24);
          await filter.selectOption('all');
          refresh = gate();
          await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
          await expect(loader).toBeVisible();
          await expect(page.getByRole('link', { name: 'Reader follow-up', exact: true })).toBeVisible();
          await expect(filter).toHaveValue('all');
          refresh.release();
          await expect(loader).toHaveCount(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        connection.release(); request.release(); contents.release(); listing.release(); refresh?.release();
        await page.unroute('**/__review-connect-fixture');
        await page.unroute('**/__review-fixture');
      }
    }
    await page.goto('/iframe.html?id=web-app-document-browser--adaptive-loading&viewMode=story');
    await expect(page.locator('main[data-surface]')).toHaveAttribute('data-surface', surface);
    await expectCenteredLoader(page.getByRole('status', { name: 'Reading and verifying document…', exact: true }));

    const sources = gate();
    await page.route('**/__home-fixture', async route => {
      await sources.promise;
      await route.fulfill({ json: {} });
    });
    try {
      await page.goto(`/iframe.html?id=web-app-home-surfaces--${surface}-${orientation}&viewMode=story&remoteFixture=true`);
      const requests = page.getByRole('region', { name: 'Review requests', exact: true });
      await expectCenteredLoader(requests.getByRole('status', { name: 'Loading sources…', exact: true }));
      await expect(page.getByRole('combobox', { name: 'Queue filter', exact: true })).toHaveCount(0);
      sources.release();
      const filter = page.getByRole('combobox', { name: 'Queue filter', exact: true });
      await expect(filter).toHaveValue('active');
      await expect(filter).toBeEnabled();
      const size = (await filter.boundingBox())!;
      expect(size.width).toBeGreaterThanOrEqual(24); expect(size.height).toBeGreaterThanOrEqual(24);
    } finally { sources.release(); }
  });
}

test('loading remains visible and accessible with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/iframe.html?id=web-app-document-browser--adaptive-loading&viewMode=story');
  const loader = page.getByRole('status', { name: 'Reading and verifying document…', exact: true });
  await expect(loader).toBeVisible();
  await expect(loader.locator('.loading-indicator-spinner')).toHaveCSS('animation-name', 'none');
  await expect(loader).toContainText('Reading and verifying document…');
});

import { expect, test } from '@playwright/test';

test('failed remote dismissal leaves the request active and reports the save error', async ({ page }) => {
  await page.route('**/__review-fixture', route => route.fulfill(route.request().method() === 'POST'
    ? { status: 403, body: 'Category write denied' } : { json: { artifacts: [], revision: 1 } }));
  await page.goto('/iframe.html?id=web-app-home-surfaces--adaptive&viewMode=story&queueRemote=true');
  await expect(page.locator('.home-requests li')).toHaveCount(4);
  await page.locator('.home-requests li').first().getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Category write denied');
  await expect(page.locator('.home-requests li')).toHaveCount(4);
  await expect(page.locator('.home-requests li').first().getByRole('button', { name: 'Dismiss', exact: true })).toBeEnabled();
});

test('remote dismissal survives a fresh browser session and can be restored', async ({ page, browser }) => {
  const records = new Map<string, unknown>();
  const remote = async (route: import('@playwright/test').Route) => {
    const key = route.request().headers()['x-review-scope'];
    if (route.request().method() === 'POST') records.set(key, route.request().postDataJSON());
    await route.fulfill({ json: records.get(key) ?? { artifacts: [], revision: 1 } });
  };
  await page.route('**/__review-fixture', remote);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-home-surfaces--adaptive&viewMode=story&queueRemote=true');
  const rows = page.locator('.home-requests li');
  await expect(rows).toHaveCount(4);
  await rows.first().getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows).toHaveCount(3);
  await page.reload();
  await expect(rows).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Queue filter', exact: true }).selectOption('dismissed');
  await expect(rows).toHaveCount(1);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.route('**/__review-fixture', remote);
  await fresh.goto(page.url());
  await expect(fresh.locator('.home-requests li')).toHaveCount(3);
  await context.close();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Queue filter', exact: true }).selectOption('active');
  await expect(rows).toHaveCount(4);
});

const orientations = [
  ['phone', 'portrait', 390, 844], ['phone', 'landscape', 844, 390],
  ['tablet', 'portrait', 820, 1180], ['tablet', 'landscape', 1180, 820],
  ['desktop', 'portrait', 900, 1440], ['desktop', 'landscape', 1440, 900],
] as const;
for (const [surface, orientation, width, height] of orientations) {
  test(`Home production ${surface} ${orientation} aggregates sources and retains pins`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/iframe.html?id=web-app-home-surfaces--${surface}-${orientation}&viewMode=story`);
    await expect(page.locator(`[data-home-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    const links = page.getByRole('region', { name: 'Review requests', exact: true }).getByRole('link');
    await expect(links).toHaveCount(4);
    const href = await page.getByRole('link', { name: 'two beta review', exact: true }).getAttribute('href');
    const url = new URL(href!.slice(1), 'https://example.test');
    expect(url.pathname).toBe('/reviews/reader-01');
    expect(Object.fromEntries(url.searchParams)).toEqual({ connection: 'two', repository: 'example/reviews', workspace: 'beta', version: 'e'.repeat(40), snapshot: '1'.repeat(40) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (surface === 'phone') await page.locator('summary').click();
    await expect(page.locator('[data-source-kind=workspace]')).toHaveCount(4);
    const requests = (await page.locator('.home-requests').boundingBox())!;
    const sources = (await page.locator('.home-sources').boundingBox())!;
    if (surface === 'desktop') expect(requests.x).toBeGreaterThan(sources.x);
    else if (surface === 'tablet' && orientation === 'landscape') expect(sources.x).toBeGreaterThan(requests.x);
    else expect(sources.y).toBeGreaterThan(requests.y);
  });
}
test('partial failure retries just its source; rotation preserves filter and operation identity without member reads', async ({ page }) => {
  const calls: string[] = []; let fail = true;
  await page.route('**/__home-fixture', route => {
    const headers = route.request().headers(), call = `${headers['x-home-operation']}:${headers['x-home-source']}`;
    calls.push(call);
    return route.fulfill(call === 'list:two/beta' && fail ? { status: 403, body: 'Access denied for Team beta' } : { json: {} });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-home-surfaces--adaptive&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveText('Access denied for Team beta');
  await page.getByRole('combobox', { name: 'Queue filter', exact: true }).selectOption('all');
  const before = [...calls];
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-home-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Queue filter', exact: true })).toHaveValue('all');
    await expect(page.getByRole('link')).toHaveCount(6);
    await expect(page.getByRole('alert')).toBeVisible();
  }
  expect(calls).toEqual(before);
  fail = false; await page.getByRole('button', { name: 'Retry source', exact: true }).click();
  await expect(page.getByRole('link')).toHaveCount(8); await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls).toEqual([...before, 'list:two/beta']);
  expect(calls.some(call => call.startsWith('forbidden-body'))).toBe(false);
});
test('manual repository and approved connection persist across all presentation swaps', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/__home-fixture', route => { const headers = route.request().headers(); calls.push(`${headers['x-home-operation']}:${headers['x-home-source']}`); return route.fulfill({ json: {} }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/iframe.html?id=web-app-home-surfaces--manual-repository&viewMode=story&remoteFixture=true');
  await page.getByRole('combobox', { name: 'Approved connection', exact: true }).selectOption('two');
  await page.getByRole('textbox', { name: 'Storage repository', exact: true }).fill('example/explicit');
  await page.getByRole('heading', { name: 'Reviews Home', exact: true }).click();
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-home-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    if (surface === 'phone' && !await page.getByRole('textbox').isVisible()) await page.locator('summary').click();
    await expect(page.getByRole('combobox', { name: 'Approved connection', exact: true })).toHaveValue('two'); await expect(page.getByRole('textbox')).toHaveValue('example/explicit');
  }
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Discover repository', exact: true }).click();
  await expect(page.getByRole('link')).toHaveCount(2);
  expect(calls).toEqual(['discover:two', 'list:two/alpha', 'list:two/beta']);
  await expect(page.getByRole('link', { name: 'two alpha review', exact: true })).toHaveAttribute('href', /repository=example%2Fexplicit/);
});
test('in-flight listings retain operation identity across rotation and finish in the active presentation', async ({ page }) => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__home-fixture', async route => {
    const headers = route.request().headers(); calls.push(`${headers['x-home-operation']}:${headers['x-home-source']}`);
    if (headers['x-home-operation'] === 'list') await gate;
    await route.fulfill({ json: {} });
  });
  await page.goto('/iframe.html?id=web-app-home-surfaces--adaptive&viewMode=story&remoteFixture=true');
  await expect.poll(() => calls.filter(call => call.startsWith('list:')).length).toBe(4);
  const started = [...calls];
  for (const [surface, orientation, width, height] of orientations) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(`[data-home-surface=${surface}][data-orientation=${orientation}]`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Review requests', exact: true }).getByRole('status')).toHaveText('Loading sources…');
    await expect(page.getByRole('link')).toHaveCount(0);
  }
  expect(calls).toEqual(started); release();
  await expect(page.getByRole('link')).toHaveCount(4);
  expect(calls).toEqual(started);
});

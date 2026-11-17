import { expect, test, type Browser } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { grantForEntry, MobileFixtureBroker, mobileBootstrap } from '../../src/mobile-protocol';

const entry = 'https://pages.example/isolation/index.html';
async function fixture(browser: Browser, options: { leakFrames?: boolean; delay?: boolean; discoveryGate?: Promise<void> } = {}) {
  const broker = new MobileFixtureBroker(); broker.approve(grantForEntry(entry));
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 Alohak/1' });
  await context.route(/https:\/\/(pages|other)\.example\//, async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^[\w./-]+\.(html|js|css)$/.test(path) || path.includes('..')) return route.fulfill({ status: 404 });
    await route.fulfill({ path: resolve('hosted-dist', path), headers: { 'Access-Control-Allow-Origin': '*' }, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await context.exposeBinding('__isolationFixtureRequest', async ({ frame, page }, raw: string) => {
    if (JSON.parse(raw).method === 'alohak.discover') await options.discoveryGate;
    const isMainFrame = frame === page.mainFrame();
    if (!isMainFrame && options.leakFrames) return { jsonrpc: '2.0', id: JSON.parse(raw).id, result: { text: 'frame-probe' } };
    const value = await broker.handleAsync({ documentId: 'browser-mock-document', documentURL: entry, isMainFrame }, raw);
    if (options.delay === false && JSON.parse(raw).method === 'alohak.discover') return { ...value, result: { capabilities: ['fixture.echo'] } };
    return value;
  });
  await context.addInitScript(`(() => {
    window.webkit = { messageHandlers: { alohak: { postMessage: raw => window.__isolationFixtureRequest(raw).then(reply => JSON.stringify(reply)) } } };
    if (window.top === window) { ${mobileBootstrap('browser-mock-document', 'ios')} }
  })();`);
  broker.activate({ documentId: 'browser-mock-document', documentURL: entry });
  const page = await context.newPage(); await page.goto(entry);
  return { context, page, broker };
}

test('isolation harness exercises real broker delays, raw frame denials and copyable evidence without claiming full acceptance', async ({ browser }) => {
  const { context, page, broker } = await fixture(browser);
  try {
    await page.locator('#cross-origin').fill('https://other.example/isolation/frame.html');
    await page.locator('#run').click();
    await expect(page.locator('#results')).toContainText('remaining device observations', { timeout: 20000 });
    await page.locator('#report').click();
    const report = JSON.parse(await page.getByLabel('Isolation report').inputValue());
    expect(report.results.filter((result: { status: string }) => result.status === 'fail')).toEqual([]);
    for (const name of ['approved main-frame control', 'concurrent out-of-order replies', 'same-origin frame', 'srcdoc frame', 'sandboxed opaque-origin frame', 'nested frame', 'different HTTPS-origin frame', 'final main-frame control']) {
      const result = report.results.find((result: { name: string }) => result.name === name);
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' });
    }
    expect(report.acceptance).toContain('no automatic overall acceptance');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('alohak-native-message', { detail: JSON.stringify({ jsonrpc: '2.0', id: 'old-lifecycle', result: { text: '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000001' } }) })));
    await expect(page.locator('#results')).toContainText('foreign lifecycle reply');
    await page.locator('#revoke').click();
    await expect(page.locator('#marker')).toContainText('Pending in-flight fixture revocation');
    broker.approve();
    await expect(page.locator('#results')).toContainText('Fixture access or document changed', { timeout: 12000 });
    await page.locator('#report').click();
    expect(JSON.parse(await page.getByLabel('Isolation report').inputValue()).results.find((result: { name: string }) => result.name === 'in-flight fixture revocation').status).toBe('pass');
  } finally { await context.close(); }
});

test('harness reports an unauthorized frame result as a failure and an old app as inconclusive', async ({ browser }) => {
  const { context, page } = await fixture(browser, { leakFrames: true, delay: false });
  try {
    await page.locator('#run').click();
    await expect(page.locator('#results')).toContainText('remaining device observations', { timeout: 20000 });
    await page.locator('#report').click();
    const report = JSON.parse(await page.getByLabel('Isolation report').inputValue());
    expect(report.results.find((result: { name: string }) => result.name === 'same-origin frame').status).toBe('fail');
    expect(report.results.find((result: { name: string }) => result.name === 'delayed-reply capability').status).toBe('inconclusive');
  } finally { await context.close(); }
});

test('standalone web page never claims native isolation without a bridge', async ({ page }) => {
  await page.route(entry, route => route.fulfill({ body: '<html></html>' }));
  // A static fixture audit also protects the earliest-inline ordering of the unapproved page.
  const outside = await readFile('hosted-dist/mobile-isolation-outside.html', 'utf8');
  expect(outside.indexOf('history.replaceState')).toBeLessThan(outside.indexOf('type="module"'));
  await page.route('https://pages.example/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^[\w./-]+\.(html|js|css)$/.test(path) || path.includes('..')) return route.fulfill({ status: 404 });
    return route.fulfill({ path: resolve('hosted-dist', path), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(entry); await page.locator('#run').click();
  await expect(page.locator('#results')).toContainText('Native bridge missing');
  await expect(page.locator('#check-status')).toContainText('Check stopped: Error: Native bridge missing');
  await expect(page.locator('#run')).toBeEnabled();
  await page.locator('#report').click();
  expect(JSON.parse(await page.getByLabel('Isolation report').inputValue()).results[0].status).toBe('inconclusive');
});

test('pending discovery is visible beside the button and a missing reply ends with an actionable error', async ({ browser }) => {
  let resume!: () => void;
  const discoveryGate = new Promise<void>(resolve => { resume = resolve; });
  const { context, page } = await fixture(browser, { discoveryGate });
  try {
    await page.locator('#run').click();
    await expect(page.locator('#run')).toHaveText('Running automatic checks…');
    await expect(page.locator('#run')).toBeDisabled();
    await expect(page.locator('#check-status')).toContainText('discovering native capabilities');
    await expect(page.locator('#revoke')).toBeDisabled();
    await expect(page.locator('#check-status')).toContainText('Check stopped: Error: Native request timed out');
    await expect(page.locator('#run')).toBeEnabled();
    await expect(page.locator('#revoke')).toBeEnabled();
    await expect(page.locator('#run')).toHaveText('Run automatic checks');
  } finally { resume(); await context.close(); }
});

test('a failed test-script load cannot leave apparently working buttons', async ({ page }) => {
  await page.route('https://pages.example/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path.endsWith('.js')) return route.abort();
    return route.fulfill({ path: resolve('hosted-dist', path), contentType: path.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto(entry);
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#report')).toBeDisabled();
  await expect(page.locator('#check-status')).toContainText('Loading test script');
  await expect(page.locator('#check-status')).toContainText('native Reload');
});

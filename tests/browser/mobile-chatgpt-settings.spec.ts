import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Executes the actual native hook/model/view with DOM leaf-control and AppState
// shims. This verifies interaction/lifecycle logic, not installed RN geometry.
async function openSettings(page: Page) {
  const result = await build({ entryPoints: ['tests/browser/fixtures/mobile-chatgpt-ui.jsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'native-settings-rehearsal', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: resolve('webapp/node_modules', args.path, args.path.includes('/') ? '../jsx-runtime.js' : 'index.js') }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: resolve('tests/browser/fixtures/native-ui.jsx') }));
    builder.onResolve({ filter: /^\.\/pi$/ }, args => args.importer.endsWith('mobile/ChatGPTConnections.hooks.ts') ? { path: resolve('tests/browser/fixtures/mobile-chatgpt-pi.ts') } : undefined);
  } }] });
  await page.route('https://native-settings.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
  await page.goto('https://native-settings.example/'); await page.addScriptTag({ content: result.outputFiles[0].text });
}
test('native ChatGPT settings survive layout changes, pause polling in background and manage scoped connections', async ({ page }) => {
  test.setTimeout(60000);
  await openSettings(page);
  await page.getByLabel('ChatGPT connection name', { exact: true }).fill('Phone account');
  for (const [width, height] of [[390, 844], [844, 390], [820, 1180], [1180, 820], [540, 820]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByLabel('ChatGPT connection name', { exact: true })).toHaveValue('Phone account');
  }
  await page.getByRole('button', { name: 'Connect to ChatGPT', exact: true }).click();
  await expect(page.getByText('NATIVE-1234', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open ChatGPT verification' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__verificationURL)).toBe('https://auth.openai.com/codex/device');
  await page.evaluate(() => (window as any).__appState('background'));
  await expect(page.getByText('NATIVE-1234', { exact: true })).toHaveCount(0);
  const polls = await page.evaluate(() => (window as any).__chatgptFixture.state.polls);
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as any).__chatgptFixture.state.polls)).toBe(polls);
  await page.evaluate(() => { (window as any).__chatgptFixture.state.approved = true; (window as any).__appState('active'); });
  await expect(page.getByText('ChatGPT · connected', { exact: true })).toBeVisible();
  await page.getByLabel('ChatGPT model: Phone account', { exact: true }).fill('new-model');
  await page.getByRole('button', { name: 'Save ChatGPT model: Phone account', exact: true }).click();
  await expect(page.getByText('Codex Responses · new-model', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grant ChatGPT access: Phone account', exact: true }).click();
  const revoke = page.getByRole('button', { name: 'Revoke ChatGPT access: Phone account https://agent.example/pi-web/', exact: true });
  await expect(revoke).toBeVisible(); await revoke.click(); await expect(revoke).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect ChatGPT: Phone account', exact: true }).click();
  await expect(page.getByText('ChatGPT · disconnected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove ChatGPT connection: Phone account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to ChatGPT: Phone account', exact: true })).toHaveCount(0);
});

test('late native sign-in responses stay hidden in background and pending login resumes after settings reopen', async ({ page }) => {
  await openSettings(page);
  await page.evaluate(() => { (window as any).__chatgptFixture.state.holdCode = true; });
  await page.getByRole('button', { name: 'Connect to ChatGPT', exact: true }).click();
  await expect(page.getByText('ChatGPT · disconnected', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__appState('background'); (window as any).__chatgptFixture.releaseCode(); });
  await expect(page.getByText('ChatGPT · connecting', { exact: true })).toBeVisible();
  await expect(page.getByText('NATIVE-1234', { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__settingsVisible(false));
  await expect(page.getByRole('button', { name: 'Connect to ChatGPT', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__settingsVisible(true); (window as any).__appState('active'); });
  await expect(page.getByText('NATIVE-1234', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel ChatGPT sign-in: ChatGPT', exact: true }).click();
  await expect(page.getByText('ChatGPT · disconnected', { exact: true })).toBeVisible();
  await expect(page.getByText('NATIVE-1234', { exact: true })).toHaveCount(0);
});

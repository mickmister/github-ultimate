import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

test('native GitHub settings expose sign-in and grant actions without any release configuration', async ({ page }) => {
  const result = await build({ entryPoints: ['tests/browser/fixtures/mobile-github-settings-ui.jsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'native-github-settings-rehearsal', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: resolve('webapp/node_modules', args.path, args.path.includes('/') ? '../jsx-runtime.js' : 'index.js') }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: resolve('tests/browser/fixtures/native-ui.jsx') }));
    builder.onResolve({ filter: /^\.\/github$/ }, args => args.importer.endsWith('mobile/GitHubConnections.tsx') ? { path: resolve('tests/browser/fixtures/mobile-github-settings-host.ts') } : undefined);
  } }] });
  await page.route('https://native-settings.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
  await page.goto('https://native-settings.example/'); await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.getByLabel('Connection name', { exact: true }).fill('Always available');
  await page.getByLabel('GitHub App ID', { exact: true }).fill('123');
  await page.getByLabel('GitHub App client ID', { exact: true }).fill('IvFixture');
  // Production hook/controls with DOM leaf shims; these are state/action
  // rehearsals, not physical RN layout or keyboard/OS acceptance.
  for (const [width, height] of [[390, 844], [844, 390], [820, 1180], [1180, 820], [540, 820]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByLabel('Connection name', { exact: true })).toHaveValue('Always available');
    await expect(page.getByRole('button', { name: 'Add GitHub connection', exact: true })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Add GitHub connection', exact: true }).click();
  await page.getByRole('button', { name: 'Start GitHub sign-in', exact: true }).click();
  await expect(page.getByText('GitHub code: ALWAYS-ON', { exact: true })).toBeVisible();
  await expect(page.getByText('Signed in as owner', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Load installations', exact: true }).click();
  await page.getByRole('button', { name: 'Use owner (7)', exact: true }).click();
  await page.getByRole('button', { name: 'List repositories', exact: true }).click();
  await expect(page.getByText('1 repositories: owner/private', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grant this deployment GitHub access', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoke GitHub deployment access', exact: true })).toBeVisible();
  expect(await page.locator('#root').innerHTML()).not.toMatch(/private-access|private-refresh|private-device/);
  await page.getByRole('button', { name: 'Disconnect GitHub connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start GitHub sign-in', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove GitHub connection', exact: true }).click();
  await expect(page.getByText('No GitHub connections yet.', { exact: true })).toBeVisible();
});

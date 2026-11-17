import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
beforeEach(() => { vi.resetModules(); vi.mocked(execFileSync).mockReset(); });
afterEach(() => vi.unstubAllEnvs());

test('mobile bundle metadata identifies its checkout rather than stale CI or EAS variables', async () => {
  vi.stubEnv('GITHUB_SHA', 'b'.repeat(40));
  vi.stubEnv('EAS_BUILD_GIT_COMMIT_HASH', 'c'.repeat(40));
  vi.mocked(execFileSync).mockReturnValue('a'.repeat(40) + '\n');
  const { default: config } = await import('../mobile/app.config');
  expect(config.extra?.buildCommit).toBe('a'.repeat(40));
});

test('an EAS source archive without Git uses the EAS build commit', async () => {
  vi.stubEnv('EAS_BUILD_GIT_COMMIT_HASH', 'd'.repeat(40));
  vi.mocked(execFileSync).mockImplementation(() => { throw new Error('No .git in build archive'); });
  const { default: config } = await import('../mobile/app.config');
  expect(config.extra?.buildCommit).toBe('d'.repeat(40));
});

test('missing or invalid build identity is displayed as unavailable', async () => {
  vi.stubEnv('EAS_BUILD_GIT_COMMIT_HASH', 'unknown');
  vi.mocked(execFileSync).mockImplementation(() => { throw new Error('No Git'); });
  const { default: config } = await import('../mobile/app.config');
  expect(config.extra?.buildCommit).toBe('unavailable');
});

test('hosted app metadata also uses the actual checkout instead of a stale GITHUB_SHA', async () => {
  vi.stubEnv('GITHUB_SHA', 'b'.repeat(40));
  vi.mocked(execFileSync).mockReturnValue('a'.repeat(40) + '\n');
  expect((await import('../webapp/build-metadata')).uiBuild).toBe('a'.repeat(40));
});

test('JS metadata and GitHub switch preserve native fingerprints while native config remains hashed', () => {
  const config = createRequire(import.meta.url)('../mobile/fingerprint.config.js');
  const source = { type: 'contents', id: 'expoConfig' };
  const baseline = JSON.stringify({ extra: { eas: { projectId: 'project' }, entryURL: 'https://example.test/', githubConnectionsEnabled: false }, plugins: ['expo-secure-store'] });
  const withCommit = (commit: string) => JSON.stringify({ extra: { buildCommit: commit, ...JSON.parse(baseline).extra }, plugins: ['expo-secure-store'] });
  expect(config.fileHookTransform(source, withCommit('a'.repeat(40)))).toBe(baseline);
  expect(config.fileHookTransform(source, withCommit('b'.repeat(40)))).toBe(baseline);
  expect(config.fileHookTransform(source, baseline)).toBe(baseline);
  const changed = JSON.parse(withCommit('a'.repeat(40))); changed.extra.githubConnectionsEnabled = true;
  expect(config.fileHookTransform(source, JSON.stringify(changed))).toBe(baseline);
  changed.plugins.push('native-plugin');
  expect(config.fileHookTransform(source, JSON.stringify(changed))).not.toBe(baseline);
  expect(JSON.parse(config.fileHookTransform(source, JSON.stringify(changed))).plugins).toContain('native-plugin');
  const patch = Buffer.from('native patch bytes');
  expect(config.fileHookTransform({ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch' }, patch)).toBe(patch);
  expect(config.extraSources).toContainEqual(expect.objectContaining({ filePath: '../patches/react-native-webview@13.15.0.patch' }));
});

test('GitHub-enabled OTA config retains the enabled value even though fingerprinting normalizes it', async () => {
  vi.stubEnv('EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS', '1');
  vi.mocked(execFileSync).mockReturnValue('a'.repeat(40));
  const { default: config } = await import('../mobile/app.config');
  expect(config.extra?.githubConnectionsEnabled).toBe(true);
  const fingerprint = createRequire(import.meta.url)('../mobile/fingerprint.config.js');
  const hashed = JSON.parse(fingerprint.fileHookTransform({ type: 'contents', id: 'expoConfig' }, JSON.stringify(config)));
  expect(hashed.extra.githubConnectionsEnabled).toBe(false);
  expect(config.extra?.githubConnectionsEnabled).toBe(true);
});

test('EAS profile fingerprint preserves the installed baseline across streamed release-flag changes', () => {
  const config = createRequire(import.meta.url)('../mobile/fingerprint.config.js');
  const baseline = { build: { base: { env: { EXPO_PROJECT_ID: 'project', EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS: '0' } }, preview: { distribution: 'internal' } } };
  const enabled = structuredClone(baseline); enabled.build.base.env.EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS = '1';
  const text = JSON.stringify(enabled, null, 2) + '\n';
  const source = { type: 'file', filePath: 'eas.json' };
  expect(config.fileHookTransform(source, Buffer.from(text.slice(0, 30)), false)).toBeNull();
  expect(config.fileHookTransform(source, Buffer.from(text.slice(30)), false)).toBeNull();
  expect(config.fileHookTransform(source, null, true)).toBe(JSON.stringify(baseline, null, 2) + '\n');
  expect(enabled.build.base.env.EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS).toBe('1');
  enabled.build.base.env.EXPO_PROJECT_ID = 'another-project';
  config.fileHookTransform(source, JSON.stringify(enabled, null, 2) + '\n', false);
  expect(config.fileHookTransform(source, null, true)).not.toBe(JSON.stringify(baseline, null, 2) + '\n');
});

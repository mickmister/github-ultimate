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

test('bundle provenance preserves native fingerprints while native config remains hashed', () => {
  const config = createRequire(import.meta.url)('../mobile/fingerprint.config.js');
  const source = { type: 'contents', id: 'expoConfig' };
  const baseline = JSON.stringify({ extra: { eas: { projectId: 'project' }, entryURL: 'https://example.test/' }, plugins: ['expo-secure-store'] });
  const withCommit = (commit: string) => JSON.stringify({ extra: { buildCommit: commit, ...JSON.parse(baseline).extra }, plugins: ['expo-secure-store'] });
  expect(config.fileHookTransform(source, withCommit('a'.repeat(40)))).toBe(baseline);
  expect(config.fileHookTransform(source, withCommit('b'.repeat(40)))).toBe(baseline);
  expect(config.fileHookTransform(source, baseline)).toBe(baseline);
  const changed = JSON.parse(withCommit('a'.repeat(40)));
  changed.plugins.push('native-plugin');
  expect(config.fileHookTransform(source, JSON.stringify(changed))).not.toBe(baseline);
  expect(JSON.parse(config.fileHookTransform(source, JSON.stringify(changed))).plugins).toContain('native-plugin');
  const patch = Buffer.from('native patch bytes');
  expect(config.fileHookTransform({ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch' }, patch)).toBe(patch);
  expect(config.extraSources).toContainEqual(expect.objectContaining({ filePath: '../patches/react-native-webview@13.15.0.patch' }));
});

test('mobile release metadata contains provenance and deployment without optional capability switches', async () => {
  vi.mocked(execFileSync).mockReturnValue('a'.repeat(40));
  const { default: config } = await import('../mobile/app.config');
  expect(Object.keys(config.extra!).sort()).toEqual(['buildCommit', 'eas', 'entryURL']);
});

test('EAS profile fingerprint hashes actual profile bytes without rewriting release configuration', () => {
  const config = createRequire(import.meta.url)('../mobile/fingerprint.config.js');
  const text = JSON.stringify({ build: { base: { env: { EXPO_PROJECT_ID: 'project' } }, preview: { distribution: 'internal' } } });
  const source = { type: 'file', filePath: 'eas.json' };
  const first = Buffer.from(text.slice(0, 30)), rest = Buffer.from(text.slice(30));
  expect(config.fileHookTransform(source, first, false)).toBe(first);
  expect(config.fileHookTransform(source, rest, false)).toBe(rest);
  expect(config.fileHookTransform(source, null, true)).toBeNull();
});

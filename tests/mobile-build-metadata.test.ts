import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

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

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// @ts-expect-error Release helper is a directly executable Node module.
import { configuredBuildProfiles, releasePlan } from '../scripts/eas-mobile.mjs';

const env = { EAS_OPERATION: 'build', EAS_PLATFORM: 'all', EAS_PROFILE: 'preview', EXPO_TOKEN: 'fixture-not-a-token', EXPO_PROJECT_ID: '11111111-2222-3333-4444-555555555555', EXPO_OWNER: 'example', EXPO_PUBLIC_COMPANION_URL: 'https://pages.example/app/', GITHUB_SHA: 'fixture-sha' };
describe('manual EAS release boundary', () => {
  it('builds with explicit profile/platform and waits without submitting', () => {
    expect(releasePlan(env).args).toEqual(['build', '--platform', 'all', '--profile', 'preview', '--non-interactive', '--wait', '--json']);
  });
  it('keeps update messages as a single argument and aligns environment/channel', () => {
    const message = '"; touch /tmp/not-executed; $(nope)';
    const plan = releasePlan({ ...env, EAS_OPERATION: 'update', EAS_MESSAGE: message });
    expect(plan.args).toEqual(['update', '--platform', 'all', '--channel', 'preview', '--environment', 'preview', '--message', message, '--non-interactive', '--json']);
  });
  it.each(['EXPO_TOKEN', 'EXPO_PROJECT_ID', 'EXPO_OWNER'])('requires explicit %s without implicit provisioning', key => {
    expect(() => releasePlan({ ...env, [key]: '' })).toThrow();
  });
  it('rejects arbitrary operations, profiles, platforms and credential-bearing URLs', () => {
    for (const override of [{ EAS_OPERATION: 'submit' }, { EAS_PROFILE: '--auto-submit' }, { EAS_PLATFORM: 'ios; nope' }, { EXPO_PUBLIC_COMPANION_URL: 'https://u:secret@pages.example/' }]) expect(() => releasePlan({ ...env, ...override })).toThrow();
  });
  it('carries only public identity/entry into uploaded build profiles', () => {
    const original = JSON.parse(readFileSync(new URL('../mobile/eas.json', import.meta.url), 'utf8'));
    const prepared = configuredBuildProfiles(original, releasePlan(env));
    expect(prepared.build.base.env).toEqual({ EXPO_PROJECT_ID: env.EXPO_PROJECT_ID, EXPO_OWNER: 'example', EXPO_PUBLIC_COMPANION_URL: env.EXPO_PUBLIC_COMPANION_URL });
    expect(JSON.stringify(prepared)).not.toContain(env.EXPO_TOKEN);
    expect(original.build.base.env).toBeUndefined();
    for (const profile of ['development', 'preview', 'production']) {
      expect(prepared.build[profile].channel).toBe(profile);
      expect(prepared.build[profile].environment).toBe(profile);
    }
  });
  it.each(['android', 'ios'])('fingerprints the actual %s native adapter without an Expo account', platform => {
    const fingerprint = JSON.parse(execFileSync('pnpm', ['--dir', 'mobile', 'exec', 'expo-updates', 'fingerprint:generate', '--platform', platform, '--workflow', 'managed'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }));
    const adapter = fingerprint.sources.find((source: { filePath?: string }) => source.filePath === `modules/companion-webview/${platform}`);
    expect(adapter?.hash).toMatch(/^[a-f\d]{40}$/);
    expect(fingerprint.hash).toMatch(/^[a-f\d]{40}$/);
  }, 60000);
});

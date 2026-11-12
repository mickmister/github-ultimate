import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Explicit, allowlisted dispatch values; user text is never shell source. */
export function releasePlan(env) {
  const operation = env.EAS_OPERATION;
  const platform = env.EAS_PLATFORM;
  const profile = env.EAS_PROFILE;
  if (!['build', 'update'].includes(operation)) throw new Error('Choose build or update.');
  if (!['all', 'android', 'ios'].includes(platform)) throw new Error('Choose all, android or ios.');
  if (!['development', 'preview', 'production'].includes(profile)) throw new Error('Choose development, preview or production.');
  if (!env.EXPO_TOKEN) throw new Error('Configure the repository EXPO_TOKEN secret.');
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(env.EXPO_PROJECT_ID ?? '')) throw new Error('Configure repository secret EXPO_PROJECT_ID with the Alohak project UUID.');
  if (!/^[\w-]+$/.test(env.EXPO_OWNER ?? '')) throw new Error('Configure repository secret EXPO_OWNER with the Expo account/organization name.');
  const entry = env.EXPO_PUBLIC_ALOHAK_URL ?? '';
  if (entry) {
    const url = new URL(entry);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('EXPO_PUBLIC_ALOHAK_URL must be a public HTTPS entry URL, without credentials.');
  }
  const message = env.EAS_MESSAGE || `Alohak ${env.GITHUB_SHA || 'manual release'}`;
  if (message.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message)) throw new Error('Update message must be at most 1000 characters without control codes.');
  const args = operation === 'build'
    ? ['build', '--platform', platform, '--profile', profile, '--non-interactive', '--wait', '--json']
    : ['update', '--platform', platform, '--channel', profile, '--environment', profile, '--message', message, '--non-interactive', '--json'];
  return {
    operation, platform, profile, args,
    // These are PUBLIC configuration, also uploaded in eas.json so the remote
    // build resolves the SAME project/entry as the dispatch runner. No tokens.
    publicEnv: { EXPO_PROJECT_ID: env.EXPO_PROJECT_ID, EXPO_OWNER: env.EXPO_OWNER, EXPO_PUBLIC_ALOHAK_URL: entry },
  };
}

export function configuredBuildProfiles(config, plan) {
  return { ...config, build: { ...config.build, base: { ...config.build.base, env: { ...config.build.base.env, ...plan.publicEnv } } } };
}

function main() {
  const plan = releasePlan(process.env);
  if (process.argv.includes('--check')) { console.log(`EAS ${plan.operation}: ${plan.platform}, ${plan.profile}; required settings present.`); return; }
  const path = new URL('../mobile/eas.json', import.meta.url);
  const original = readFileSync(path, 'utf8');
  // EAS uploads the worktree, including this public config diff. Restore it on
  // success/failure so local invocations cannot leave release config changes.
  writeFileSync(path, JSON.stringify(configuredBuildProfiles(JSON.parse(original), plan), null, 2) + '\n');
  try {
    const result = spawnSync('pnpm', ['--dir', 'mobile', 'exec', 'eas', ...plan.args], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...plan.publicEnv }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (process.env.EAS_RESULT_PATH && result.stdout) writeFileSync(process.env.EAS_RESULT_PATH, result.stdout);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`EAS ${plan.operation} failed (exit ${result.status ?? 'unknown'}). See CLI diagnostics above.`);
    const receipt = JSON.parse(result.stdout);
    const project = `https://expo.dev/accounts/${plan.publicEnv.EXPO_OWNER}/projects/alohak`;
    const records = Array.isArray(receipt) ? receipt : [receipt];
    const links = plan.operation === 'build'
      ? records.filter(item => typeof item.id === 'string' && /^[\w-]+$/.test(item.id)).map(item => `[${item.platform ?? 'Build'}](${project}/builds/${item.id})`)
      : records.filter(item => typeof item.group === 'string' && /^[\w-]+$/.test(item.group)).map(item => `[Update group](${project}/updates/${item.group})`);
    const summary = `## EAS ${plan.operation}\n\nSource: \`${process.env.GITHUB_SHA ?? 'local'}\`\n\nPlatform: ${plan.platform} · Profile/channel: ${plan.profile}\n\n${[...new Set(links)].join(' · ') || `[Expo project](${project})`}\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary);
  } finally { writeFileSync(path, original); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'EAS release failed.'); process.exitCode = 1; }
}

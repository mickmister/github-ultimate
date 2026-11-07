import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh, type Gh, type Environment } from './publish-form.ts';
import { downloadLinks, releaseArtifact } from './release-assets.ts';

export function prereleaseMetadata(env: Environment) {
  const repository = env.GITHUB_REPOSITORY ?? '';
  const branch = env.GITHUB_REF_NAME ?? '';
  const sha = env.GITHUB_SHA ?? '';
  const run = env.GITHUB_RUN_ID ?? '';
  if (env.GITHUB_EVENT_NAME !== 'push' || !branch || env.GITHUB_REF !== `refs/heads/${branch}` || env.GITHUB_EVENT_DELETED === 'true') throw new Error('Continuous prereleases require a non-deletion branch push.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9]\d*$/.test(run)) throw new Error('Missing or invalid GitHub repository, commit SHA or workflow run ID.');
  const slug = branch.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60);
  // Run IDs distinguish separate pushes, including identical SHAs on different
  // branches. A rerun keeps its run ID, so it never creates a second release.
  const tag = `continuous-${slug}-${run}`;
  const url = `https://github.com/${repository}/releases/tag/${tag}`;
  const notes = [
    'Automated, verified Chrome extension prerelease.', '',
    `- Branch: ${branch.replace(/[\\`*_[\]<>]/g, '\\$&')}`,
    `- Commit: \`${sha}\``,
    `- Workflow: https://github.com/${repository}/actions/runs/${run}`,
    '', 'Download the ZIP and extract it, then load the folder in chrome://extensions with Developer mode enabled.',
    'For an existing installation, replace its extracted files and click Reload. The .sha256 asset contains the ZIP checksum.',
    '', 'This is a development prerelease. Its source commit and workflow identify the build; the extension manifest keeps the package version.',
  ].join('\n');
  return { repository, sha, tag, url, title: `GitHub Ultimate · ${branch} · ${sha.slice(0, 8)}`, notes };
}

export function publishPrerelease(env: Environment, run: Gh = gh, directory = 'release'): string {
  const meta = prereleaseMetadata(env);
  const { archive, assets } = releaseArtifact(directory);
  const notes = `${downloadLinks(meta.repository, meta.tag, archive)}\n\n${meta.notes}`;

  let existing: { targetCommitish?: string; isPrerelease?: boolean } | undefined;
  try {
    existing = JSON.parse(run(['release', 'view', meta.tag, '--repo', meta.repository, '--json', 'targetCommitish,isPrerelease']));
  } catch (error) {
    // Authentication/network failures must not be mistaken for a missing release.
    if (!/release not found|HTTP 404/i.test(String(error))) throw error;
  }
  if (existing && (existing.targetCommitish !== meta.sha || !existing.isPrerelease)) throw new Error('Existing release does not match this prerelease run and commit.');
  if (!existing) run(['release', 'create', meta.tag, '--repo', meta.repository, '--target', meta.sha, '--title', meta.title, '--notes', notes, '--draft', '--prerelease', '--latest=false']);
  // Keep new releases in draft until both tested assets have uploaded. A failed
  // upload can be retried against the same draft/tag on a workflow rerun.
  run(['release', 'upload', meta.tag, ...assets, '--repo', meta.repository, '--clobber']);
  run(['release', 'edit', meta.tag, '--repo', meta.repository, '--title', meta.title, '--notes', notes, '--draft=false', '--prerelease', '--latest=false']);
  return meta.url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(publishPrerelease(process.env)); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}

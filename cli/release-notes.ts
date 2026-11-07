import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadLinks, releaseArtifact } from './release-assets.ts';

export function stableReleaseNotes(env: Record<string, string | undefined>, directory = 'release', notesFile = 'docs/release-notes.md'): string {
  const tag = env.GITHUB_REF_NAME ?? '';
  if (env.GITHUB_REF !== `refs/tags/${tag}` || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Stable release notes require a version tag.');
  const { archive } = releaseArtifact(directory);
  if (archive !== `github-ultimate-chrome-${tag.slice(1)}.zip`) throw new Error('Release tag does not match the CI-built artifact version.');
  return `${downloadLinks(env.GITHUB_REPOSITORY ?? '', tag, archive)}\n\n${readFileSync(notesFile, 'utf8')}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(stableReleaseNotes(process.env)); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}

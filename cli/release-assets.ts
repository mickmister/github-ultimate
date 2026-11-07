import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function releaseArtifact(directory = 'release') {
  const names = readdirSync(directory);
  const archives = names.filter(name => /^github-ultimate-chrome-[\d.]+\.zip$/.test(name));
  if (archives.length !== 1 || names.length !== 2 || !names.includes(`${archives[0]}.sha256`)) throw new Error('Expected exactly one CI-built extension ZIP and its checksum.');
  const archive = archives[0];
  const assets = [resolve(directory, archive), resolve(directory, `${archive}.sha256`)];
  const checksum = createHash('sha256').update(readFileSync(assets[0])).digest('hex');
  if (readFileSync(assets[1], 'utf8') !== `${checksum}  ${archive}\n`) throw new Error('CI artifact checksum does not match the extension ZIP.');
  return { archive, assets };
}

export function downloadLinks(repository: string, tag: string, archive: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !tag || !/^github-ultimate-chrome-[\d.]+\.zip$/.test(archive)) throw new Error('Invalid release download coordinates.');
  const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
  return [
    '## Download', '',
    `- [Download Chrome extension (ZIP)](${base}/${encodeURIComponent(archive)})`,
    `- [SHA-256 checksum](${base}/${encodeURIComponent(`${archive}.sha256`)})`,
  ].join('\n');
}

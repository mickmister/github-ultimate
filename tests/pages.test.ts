import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error The publisher is deliberately dependency-free JavaScript for CI.
import { previewDirectory, publishHosted, previewLimit, payloadSize } from '../scripts/publish-hosted.mjs';

test('publisher replaces one preview per branch, preserves peers, prunes deletions and skips stale source builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pages-proof-'));
  const remote = join(root, 'remote.git'), repo = join(root, 'source'), source = join(root, 'payload'), output = join(root, 'site');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    await mkdir(repo); await mkdir(source);
    git(['init', '--bare', remote], root); git(['init', '--initial-branch=main']);
    await writeFile(join(repo, 'source.txt'), 'source'); git(['add', '.']); git(['commit', '-m', 'Initial']);
    git(['remote', 'add', 'origin', remote]); git(['push', 'origin', 'main']); git(['push', 'origin', 'HEAD:refs/heads/feature/a']);
    const sha = git(['rev-parse', 'HEAD']);
    await writeFile(join(source, 'index.html'), '<h1>Hosted</h1>'); await writeFile(join(source, 'build.json'), JSON.stringify({ sha }));
    await writeFile(join(source, 'obsolete.js'), 'old bundle');
    const publish = (branch: string, revision = sha) => publishHosted({ remote, source, output, branch, sha: revision });
    await publish('main'); await publish('feature/a');
    expect(await readdir(join(output, 'previews'))).toHaveLength(2);
    await rm(join(source, 'obsolete.js')); await writeFile(join(source, 'new.js'), 'new bundle');
    await publish('main');
    expect(await readdir(join(output, 'previews', previewDirectory('main')))).not.toContain('obsolete.js');
    expect(await readdir(join(output, 'previews', previewDirectory('feature/a')))).toContain('obsolete.js');
    const manifest = JSON.parse(await readFile(join(output, 'previews.json'), 'utf8'));
    expect(Object.keys(manifest)).toHaveLength(2);
    const priorPages = git(['ls-remote', 'origin', 'refs/heads/gh-pages']);
    await writeFile(join(repo, 'source.txt'), 'advanced'); git(['add', '.']); git(['commit', '-m', 'Advance']); git(['push', 'origin', 'main']);
    expect((await publish('main')).skipped).toBe(true);
    expect(git(['ls-remote', 'origin', 'refs/heads/gh-pages'])).toBe(priorPages);
    git(['push', 'origin', '--delete', 'main']);
    await publish('feature/a');
    expect(Object.keys(JSON.parse(await readFile(join(output, 'previews.json'), 'utf8')))).toEqual(['feature/a']);
    git(['push', 'origin', '--delete', 'feature/a']);
    await publishHosted({ remote, source, output, branch: 'feature/a', sha, deleted: true });
    expect(JSON.parse(await readFile(join(output, 'previews.json'), 'utf8'))).toEqual({});
    expect(await readdir(join(output, 'previews'))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('preview paths avoid branch slash/slug collisions and block oversized or linked payloads', async () => {
  expect(previewDirectory('feature/a')).not.toBe(previewDirectory('feature-a'));
  expect(previewDirectory('../../escape')).not.toContain('/');
  const root = await mkdtemp(join(tmpdir(), 'pages-size-'));
  try {
    await writeFile(join(root, 'huge.js'), 'x'.repeat(previewLimit + 1));
    await expect(publishHosted({ remote: 'unused', source: root, output: join(root, 'output'), branch: 'main', sha: 'a'.repeat(40) })).rejects.toThrow('1 MiB');
    await rm(join(root, 'huge.js')); await symlink('/etc/passwd', join(root, 'link'));
    await expect(payloadSize(root)).rejects.toThrow('regular files');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('hosted production build uses relative subpath assets and no source maps', async () => {
  execFileSync(process.execPath, ['scripts/build-hosted.mjs'], { cwd: resolve('.'), env: { ...process.env, GITHUB_REF_NAME: 'test/subpath' } });
  const html = await readFile('hosted-dist/index.html', 'utf8');
  expect(html).toMatch(/src="\.\/main-[A-Z0-9]+\.js"/); expect(html).toMatch(/href="\.\/main-[A-Z0-9]+\.css"/);
  for (const [, asset] of html.matchAll(/(?:src|href)="\.\/([^"/]+\.(?:js|css))"/g)) expect(await readdir('hosted-dist')).toContain(asset);
  const settings = await readFile('hosted-dist/settings.html', 'utf8');
  expect(settings).toMatch(/src="\.\/settings-[A-Z0-9]+\.js"/);
  expect(html).toContain('href="./settings.html"');
  expect(settings).toContain('href="./"');
  expect((await readdir('hosted-dist')).some(name => name.endsWith('.map'))).toBe(false);
  expect(JSON.parse(await readFile('hosted-dist/build.json', 'utf8')).branch).toBe('test/subpath');
  expect(await payloadSize('hosted-dist')).toBeLessThan(previewLimit);
  // The hosted app must not accidentally import Zod/the privileged broker.
  expect(await payloadSize('hosted-dist')).toBeLessThan(64 * 1024);
});

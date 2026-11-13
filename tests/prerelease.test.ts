import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prereleaseMetadata, publishPrerelease } from '../cli/prerelease';
import { stableReleaseNotes } from '../cli/release-notes';

const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/vk/test', GITHUB_REF_NAME: 'vk/test', GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' };
const temporary: string[] = [];
function artifact(version = '0.1.1') {
  const path = mkdtempSync(join(tmpdir(), 'github-ultimate-prerelease-')); temporary.push(path);
  const name = `github-ultimate-chrome-${version}.zip`;
  const bytes = Buffer.from('CI artifact fixture');
  writeFileSync(join(path, name), bytes);
  writeFileSync(join(path, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  return path;
}
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('continuous prerelease publishing', () => {
  it('uses one release per push run, stable across retries and distinct for branch slug collisions', () => {
    const first = prereleaseMetadata(env);
    expect(prereleaseMetadata({ ...env, GITHUB_RUN_ATTEMPT: '2' }).tag).toBe(first.tag);
    expect(prereleaseMetadata({ ...env, GITHUB_RUN_ID: '124' }).tag).not.toBe(first.tag);
    expect(prereleaseMetadata({ ...env, GITHUB_REF: 'refs/heads/vk-test', GITHUB_REF_NAME: 'vk-test', GITHUB_RUN_ID: '125' }).tag).not.toBe(first.tag);
  });
  it('uploads the verified artifact before making a new prerelease public', () => {
    const path = artifact();
    const run = vi.fn((args: string[]) => { if (args[1] === 'view') throw new Error('gh release view failed: release not found'); return ''; });
    expect(publishPrerelease(env, run, path)).toBe('https://github.com/owner/repo/releases/tag/continuous-vk-test-123');
    expect(run.mock.calls.map(([args]) => args[1])).toEqual(['view', 'create', 'upload', 'edit']);
    const create = run.mock.calls[1][0];
    expect(create).toContain('--draft'); expect(create).toContain('--prerelease'); expect(create).toContain('--latest=false');
    expect(create[create.indexOf('--target') + 1]).toBe(env.GITHUB_SHA);
    expect(run.mock.calls[2][0]).toContain(join(path, 'github-ultimate-chrome-0.1.1.zip.sha256'));
    expect(run.mock.calls[3][0]).toContain('--draft=false');
    for (const args of [create, run.mock.calls[3][0]]) {
      const notes = args[args.indexOf('--notes') + 1];
      expect(notes).toContain('[Download Chrome extension (ZIP)](https://github.com/owner/repo/releases/download/continuous-vk-test-123/github-ultimate-chrome-0.1.1.zip)');
      expect(notes).toContain('[SHA-256 checksum](https://github.com/owner/repo/releases/download/continuous-vk-test-123/github-ultimate-chrome-0.1.1.zip.sha256)');
    }
  });
  it('repairs an interrupted draft or existing prerelease without creating another release', () => {
    const path = artifact();
    const run = vi.fn((args: string[]) => args[1] === 'view' ? JSON.stringify({ targetCommitish: env.GITHUB_SHA, isPrerelease: true }) : '');
    publishPrerelease(env, run, path);
    expect(run.mock.calls.map(([args]) => args[1])).toEqual(['view', 'upload', 'edit']);
    expect(run.mock.calls[1][0]).toContain('--clobber');
    const edit = run.mock.calls[2][0];
    expect(edit[edit.indexOf('--notes') + 1]).toContain('/releases/download/continuous-vk-test-123/github-ultimate-chrome-0.1.1.zip)');
  });
  it('leaves a new release unpublished when asset upload fails', () => {
    const path = artifact();
    const run = vi.fn((args: string[]) => {
      if (args[1] === 'view') throw new Error('HTTP 404');
      if (args[1] === 'upload') throw new Error('upload interrupted');
      return '';
    });
    expect(() => publishPrerelease(env, run, path)).toThrow('upload interrupted');
    expect(run.mock.calls.map(([args]) => args[1])).toEqual(['view', 'create', 'upload']);
  });
  it('fails before publication for corrupt artifacts, wrong event types or conflicting releases', () => {
    const path = artifact(); const run = vi.fn(() => '');
    for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/tags/v0.1.1' }, { GITHUB_EVENT_DELETED: 'true' }]) expect(() => publishPrerelease({ ...env, ...change }, run, path)).toThrow('branch push');
    expect(run).not.toHaveBeenCalled();
    writeFileSync(join(path, 'github-ultimate-chrome-0.1.1.zip'), 'corrupt');
    expect(() => publishPrerelease(env, run, path)).toThrow('checksum');
    expect(run).not.toHaveBeenCalled();
    const conflict = vi.fn(() => JSON.stringify({ targetCommitish: 'b'.repeat(40), isPrerelease: true }));
    expect(() => publishPrerelease(env, conflict, artifact())).toThrow('does not match');
    expect(conflict).toHaveBeenCalledTimes(1);
  });
  it('does not turn authentication or network failures into release creation attempts', () => {
    const run = vi.fn(() => { throw new Error('HTTP 403: forbidden'); });
    expect(() => publishPrerelease(env, run, artifact())).toThrow('HTTP 403');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('links the actual uploaded version instead of assuming the current package version', () => {
    const run = vi.fn((args: string[]) => { if (args[1] === 'view') throw new Error('HTTP 404'); return ''; });
    publishPrerelease(env, run, artifact('4.5.6'));
    const edit = run.mock.calls.at(-1)![0];
    expect(edit[edit.indexOf('--notes') + 1]).toContain('/releases/download/continuous-vk-test-123/github-ultimate-chrome-4.5.6.zip)');
    expect(run.mock.calls[2][0].some(arg => arg.endsWith('/github-ultimate-chrome-4.5.6.zip'))).toBe(true);
  });
  it('prepends tag-specific download links to stable release notes', () => {
    const notes = stableReleaseNotes({ ...env, GITHUB_REF: 'refs/tags/v4.5.6', GITHUB_REF_NAME: 'v4.5.6' }, artifact('4.5.6'));
    expect(notes).toMatch(/^## Download/);
    expect(notes).toContain('[Download Chrome extension (ZIP)](https://github.com/owner/repo/releases/download/v4.5.6/github-ultimate-chrome-4.5.6.zip)');
    expect(notes).toContain('[SHA-256 checksum](https://github.com/owner/repo/releases/download/v4.5.6/github-ultimate-chrome-4.5.6.zip.sha256)');
    expect(notes).toContain('Load unpacked');
  });
  it('does not generate stable download links for a mismatched tag or corrupt artifact', () => {
    const path = artifact();
    expect(() => stableReleaseNotes(env, path)).toThrow('version tag');
    expect(() => stableReleaseNotes({ ...env, GITHUB_REF: 'refs/tags/v4.5.6', GITHUB_REF_NAME: 'v4.5.6' }, path)).toThrow('artifact version');
    writeFileSync(join(path, 'github-ultimate-chrome-0.1.1.zip'), 'corrupt');
    expect(() => stableReleaseNotes({ ...env, GITHUB_REF: 'refs/tags/v0.1.1', GITHUB_REF_NAME: 'v0.1.1' }, path)).toThrow('checksum');
  });
});

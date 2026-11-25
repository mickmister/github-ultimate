import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error The publisher is deliberately dependency-free JavaScript for CI.
import { previewDirectory as publishedDirectory } from '../scripts/publish-hosted.mjs';
import { loadPreviewSlots, previewURL, resolvePreviewSlots, workspaceConfigSchema } from '../hosted/preview-slots';
import { previewDirectory } from '../src/preview-directory';
import type { WorkspaceManifest } from '../hosted/manifest';
import type { PiBridge } from '../hosted/pi-transport';

const branch = 'vk/46e5-vd-multi-instanc', workspace = 'vk-46e5-vd-multi-instanc';
const manifest: WorkspaceManifest = { schema_version: 1, workspace, observed_at: '2026-11-24T00:00:00Z', repositories: [{ path: 'github-ultimate', branch: `refs/heads/${branch}`, commit: 'c'.repeat(40), publication: 'unverified', remotes: [{ name: 'origin', url: 'https://github.com/mickmister/github-ultimate.git' }] }] };
const provider = { kind: 'github-pages' as const, baseUrl: 'https://mickmister.github.io/github-ultimate/', path: 'pi-web-storybooks/{previewDirectory}/' };
const config = { schema_version: 1, repositories: [{ repository: 'mickmister/github-ultimate', previewSlots: [{ id: 'storybook', title: 'Pi Web Storybook', service: 'pi-web-storybook', provider }] }] };
function fixture() {
  const connectionId = crypto.randomUUID(), calls: Parameters<PiBridge>[0][] = [];
  const navigation = { connectionId, installationId: 123, repository: 'owner/storage', workspace };
  const blobs = new Map<string, { sha: string; size: number; content: string; encoding: 'base64' }>();
  const entries = new Map<string, { path: string; mode: string; type: 'blob'; sha: string; size: number }>();
  function file(path: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value)), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha, { sha, size: bytes.length, content: bytes.toString('base64'), encoding: 'base64' });
    entries.set(path, { path, sha, size: bytes.length, mode: '100644', type: 'blob' });
  }
  file('documents/workspace/manifest.json', manifest); file('documents/workspace-config.json', config);
  const send: PiBridge = async <T>(request: Parameters<PiBridge>[0]) => {
    calls.push(request);
    if (request.operation === 'connections') return [{ id: connectionId, appId: 1, name: 'Storage', installation: { id: 123, account: 'owner' } }] as T;
    if (request.operation === 'repositories') return [{ full_name: 'owner/storage' }] as T;
    if (request.operation === 'loadNavigation') return navigation as T;
    if (request.operation === 'saveNavigation') return null as T;
    if (request.operation === 'gitRefs') return (request.prefix === 'documents/' ? [{ ref: `refs/documents/${workspace}`, object: { sha: 'a'.repeat(40), type: 'commit' } }] : []) as T;
    if (request.operation === 'gitCommit') return { sha: request.oid, tree: { sha: 'b'.repeat(40) } } as T;
    if (request.operation === 'gitTree') return { sha: request.oid, truncated: false, tree: [...entries.values()] } as T;
    if (request.operation === 'gitBlob') return blobs.get(request.oid) as T;
    throw Error(`Unexpected ${request.operation}`);
  };
  return { navigation, send, calls, file, entries, blobs };
}
it('uses exactly the publisher branch identity, including collisions and Unicode', () => {
  for (const value of [branch, 'main', 'a/b', 'a-b', 'É/🌴', 'a'.repeat(150), 'Case']) {
    expect(previewDirectory(value)).toBe(`b-${value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`);
    expect(previewDirectory(value)).toBe(publishedDirectory(value));
  }
  expect(previewDirectory(branch)).toBe('b-vk-46e5-vd-multi-instanc-0940c2d95906d253');
  expect(previewDirectory('a/b')).not.toBe(previewDirectory('a-b'));
});
it('loads the Pages publisher in an isolated checkout without node_modules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pages-no-dependencies-'));
  try {
    const file = join(directory, 'publish-hosted.mjs'); await copyFile(resolve('scripts/publish-hosted.mjs'), file);
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `const {previewDirectory}=await import(${JSON.stringify(pathToFileURL(file).href)});console.log(previewDirectory(${JSON.stringify(branch)}))`], { cwd: directory, encoding: 'utf8' });
    expect(output.trim()).toBe(previewDirectory(branch));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('creates canonical Pages URLs and provider-neutral templates without guessing a Cloudflare alias', () => {
  const context = { repository: 'mickmister/github-ultimate', workspace, branch };
  expect(previewURL(provider, context)).toBe(`https://mickmister.github.io/github-ultimate/pi-web-storybooks/${previewDirectory(branch)}/`);
  expect(previewURL({ kind: 'url-template', url: 'https://preview.example.workers.dev/{workspace}/{owner}/{repository}?branch={branch}' }, context)).toBe(`https://preview.example.workers.dev/${workspace}/mickmister/github-ultimate?branch=vk%2F46e5-vd-multi-instanc`);
  expect(previewURL({ kind: 'url-template', url: 'https://project.pages.dev/{workspace}/' }, context)).toContain(`/${workspace}/`);
});
it('rejects executable/credential URLs, escaping paths and unknown or missing template variables', () => {
  const context = { repository: 'owner/repo', workspace };
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://secret@site.example/', 'https://site.example/{unknown}', 'https://site.example/{branch}']) expect(() => previewURL({ kind: 'url-template', url }, context)).toThrow();
  for (const path of ['../outside/', '//other.example/', '%2e%2e/outside/', 'https://other.example/']) expect(() => previewURL({ ...provider, path }, context)).toThrow();
});
it('binds slots to manifest repositories and isolates invalid or ambiguous entries', () => {
  const parsed = workspaceConfigSchema.parse(config);
  expect(resolvePreviewSlots(parsed, manifest)[0].url).toContain(previewDirectory(branch));
  expect(resolvePreviewSlots(parsed, { ...manifest, repositories: [] })[0]).toMatchObject({ error: expect.stringContaining('exactly one') });
  expect(resolvePreviewSlots(parsed, { ...manifest, repositories: [...manifest.repositories!, ...manifest.repositories!] })[0]).not.toHaveProperty('url');
  expect(() => workspaceConfigSchema.parse({ ...config, repositories: [config.repositories[0], config.repositories[0]] })).toThrow('unique');
});
it('reads config and branch context from the selected nugs workspace snapshot with verified Git blobs', async () => {
  const f = fixture(), result = await loadPreviewSlots(f.send, '');
  expect(result).toMatchObject({ workspace, slots: [{ title: 'Pi Web Storybook', url: `https://mickmister.github.io/github-ultimate/pi-web-storybooks/${previewDirectory(branch)}/` }] });
  expect(result.version).toBe(f.entries.get('documents/workspace-config.json')!.sha);
  expect(f.calls.filter(request => request.operation.startsWith('git')).every(request => 'repository' in request && request.repository === 'owner/storage')).toBe(true);
  const blob = f.blobs.get(result.version!)!; blob.content = Buffer.from('{}').toString('base64');
  await expect(loadPreviewSlots(f.send, '')).rejects.toThrow('size mismatch');
});
it('uses explicit workspace context without silent navigation fallback and handles missing config', async () => {
  const f = fixture(), query = new URLSearchParams({ connection: f.navigation.connectionId, repository: 'owner/storage', workspace });
  expect((await loadPreviewSlots(f.send, query.toString())).slots).toHaveLength(1);
  expect(f.calls.some(request => request.operation === 'loadNavigation')).toBe(false);
  f.entries.delete('documents/workspace-config.json'); expect((await loadPreviewSlots(f.send, '')).slots).toHaveLength(0);
  await expect(loadPreviewSlots(f.send, '?workspace=other')).rejects.toThrow('Choose a nugs workspace');
});
it('resolves device-local authorization from the stable shared workspace URL', async () => {
  const f = fixture();
  for (const connection of ['', crypto.randomUUID()]) {
    const query = new URLSearchParams({ repository: 'owner/storage', workspace, ...(connection ? { connection } : {}) });
    expect((await loadPreviewSlots(f.send, query.toString())).navigation?.connectionId).toBe(f.navigation.connectionId);
  }
});

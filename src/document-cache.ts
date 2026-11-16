import { z } from 'zod';
import { gitOid, workspaceName, maxBlobBytes, readGit, verifiedGitBlobBytes, type GitRead, type GitRef, type GitCommit, type GitTree, type GitBlob } from './git-reads';
import type { CacheScope, WorkspaceCache } from './workspace-cache';
import { parseWorkspaceManifest } from '../hosted/manifest';

const scopeFields = { id: z.string().uuid(), installationId: z.number().int().positive(), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(220), workspace: workspaceName };
export const documentCacheSchema = z.object({ operation: z.literal('documentCache'), ...scopeFields, action: z.enum(['fill', 'restore']), commit: gitOid.optional(), priority: z.array(gitOid).max(100).default([]) }).strict();
export type DocumentCacheRequest = z.infer<typeof documentCacheSchema>;
export interface DocumentCacheStatus { commit?: string; complete: boolean; cached: number; total: number; error: string }
const inventorySchema = z.object({ commit: gitOid, tree: gitOid, blobs: z.array(z.object({ oid: gitOid, size: z.number().int().nonnegative() })).max(10000) });
type Inventory = z.infer<typeof inventorySchema>;
const stateSchema = z.object({ complete: inventorySchema.optional(), pending: inventorySchema.optional() });
const stateKey = 'documentSnapshots:v1';
export const reviewCachePinsKey = 'reviewResources:v1';
const resources = (inventory: Inventory) => [`gitCommit:${inventory.commit}`, `gitTree:${inventory.tree}`, ...inventory.blobs.map(blob => `gitBlob:${blob.oid}`)];

/** Each fill call fetches at most one missing blob. Verified objects are the resume journal.
 * Connections serializes calls with settings/access changes; promotion and collection share
 * one adapter transaction. A failed write never destroys the last complete snapshot. */
export async function documentCache(cache: WorkspaceCache, scope: CacheScope, request: DocumentCacheRequest, read: <T>(request: GitRead) => Promise<T>, current: () => boolean): Promise<DocumentCacheStatus> {
  const state = stateSchema.parse(await cache.get(scope, stateKey) ?? {});
  const input = (operation: 'gitCommit' | 'gitTree' | 'gitBlob', oid: string): GitRead => ({ operation, id: request.id, installationId: request.installationId, repository: request.repository, workspace: request.workspace, oid });
  async function load<T>(operation: 'gitCommit' | 'gitTree' | 'gitBlob', oid: string): Promise<T> {
    const key = `${operation}:${oid}`, cached = await cache.get(scope, key);
    if (cached !== undefined) {
      try { await readGit(input(operation, oid), request.repository, async () => cached); if (operation === 'gitBlob') verifiedGitBlobBytes(cached as GitBlob); return cached as T; }
      catch { await cache.remove(scope, key); }
    }
    const value = await read<T>(input(operation, oid));
    if (!current()) throw new Error('Document or connection access changed.');
    if (operation === 'gitBlob') verifiedGitBlobBytes(value as GitBlob);
    if (!await cache.put(scope, key, value)) throw new Error('Workspace cache capacity or storage unavailable; previous complete snapshot retained.');
    return value;
  }
  async function count(inventory: Inventory) {
    let cached = 0;
    for (const blob of inventory.blobs) {
      const value = await cache.get(scope, `gitBlob:${blob.oid}`) as GitBlob | undefined;
      if (value) { try { verifiedGitBlobBytes(value); if (value.size === blob.size) cached++; } catch { await cache.remove(scope, `gitBlob:${blob.oid}`); } }
    }
    return cached;
  }
  if (request.action === 'restore') {
    const inventory = state.complete ?? state.pending;
    if (!inventory) return { complete: false, cached: 0, total: 0, error: '' };
    const cached = await count(inventory);
    const metadata = await cache.get(scope, `gitCommit:${inventory.commit}`) && await cache.get(scope, `gitTree:${inventory.tree}`);
    return { commit: metadata ? inventory.commit : undefined, complete: Boolean(metadata && state.complete === inventory && cached === inventory.blobs.length), cached, total: inventory.blobs.length, error: '' };
  }
  if (!request.commit) throw new Error('A verified Documents commit is required.');
  try {
    if (state.complete?.commit === request.commit) {
      const cached = await count(state.complete);
      if (cached === state.complete.blobs.length) return { commit: request.commit, complete: true, cached, total: cached, error: '' };
    }
    if (state.pending?.commit !== request.commit) {
      const refs = await read<GitRef[]>({ operation: 'gitRefs', id: request.id, installationId: request.installationId, repository: request.repository, prefix: 'documents/' });
      if (refs.find(ref => ref.ref === `refs/documents/${request.workspace}`)?.object.sha !== request.commit) throw new Error('Documents advanced to another snapshot. Refresh the workspace to resume caching.');
    }
    if (state.pending && state.pending.commit !== request.commit) {
      const retained = new Set([...(state.complete ? resources(state.complete) : []), ...z.array(z.string()).parse(await cache.get(scope, reviewCachePinsKey) ?? [])]);
      const garbage = retained.has('*') ? [] : resources(state.pending).filter(key => !retained.has(key));
      if (!await cache.put(scope, stateKey, { complete: state.complete }, garbage)) throw new Error('Unable to retire interrupted inventory.');
      state.pending = undefined;
    }
    if (state.pending?.commit !== request.commit && state.complete?.commit !== request.commit) {
      const commit = await load<GitCommit>('gitCommit', request.commit);
      const tree = await load<GitTree>('gitTree', commit.tree.sha);
      if (commit.sha !== request.commit || tree.sha !== commit.tree.sha || tree.truncated) throw new Error('Incomplete or mismatched Documents inventory.');
      const entries = tree.tree.filter(entry => entry.path.startsWith('documents/') && entry.type !== 'tree');
      if (entries.some(entry => entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || entry.size === undefined || entry.size > maxBlobBytes)) throw new Error('Documents inventory contains an unsupported file or an object over the 16 MiB read limit.');
      const manifest = entries.find(entry => entry.path === 'documents/workspace/manifest.json');
      if (!manifest) throw new Error('Workspace manifest is required.');
      const blob = await load<GitBlob>('gitBlob', manifest.sha);
      if (blob.size !== manifest.size) throw new Error('Workspace manifest size mismatch.');
      // The host validates workspace identity before treating an inventory as eligible.
      const bytes = verifiedGitBlobBytes(blob);
      if (bytes.length > 256 * 1024) throw new Error('Workspace manifest exceeds the cache inventory limit.');
      parseWorkspaceManifest(decodeURIComponent(Array.from(bytes, byte => '%' + byte.toString(16).padStart(2, '0')).join('')), request.workspace);
      const blobs = [...new Map(entries.map(entry => [entry.sha, { oid: entry.sha, size: entry.size! }])).values()];
      const pending = { commit: request.commit, tree: tree.sha, blobs };
      if (!await cache.put(scope, stateKey, { ...state, pending })) throw new Error('Unable to persist Documents inventory; previous complete snapshot retained.');
      state.pending = pending;
    }
    const inventory = state.pending?.commit === request.commit ? state.pending : state.complete!;
    const ordered = [...inventory.blobs].sort((a, b) => Number(request.priority.includes(b.oid)) - Number(request.priority.includes(a.oid)));
    const present = new Set(await cache.resources(scope));
    for (const blob of ordered) {
      if (present.has(`gitBlob:${blob.oid}`)) continue;
      const loaded = await load<GitBlob>('gitBlob', blob.oid);
      if (loaded.size !== blob.size) throw new Error('Documents inventory blob size mismatch.');
      present.add(`gitBlob:${blob.oid}`);
      break;
    }
    // Metadata-only progress avoids re-reading every blob after each single download.
    // Before promotion, verify the entire set, including objects reused from older snapshots.
    let cached = inventory.blobs.filter(blob => present.has(`gitBlob:${blob.oid}`)).length;
    if (cached === inventory.blobs.length) cached = await count(inventory);
    const complete = cached === inventory.blobs.length;
    if (complete) {
      const retained = new Set([...resources(inventory), ...z.array(z.string()).parse(await cache.get(scope, reviewCachePinsKey) ?? [])]);
      const garbage = (await cache.resources(scope)).filter(key => /^git(?:Blob|Tree|Commit):/.test(key) && !retained.has(key));
      if (!current()) throw new Error('Document or connection access changed.');
      if (!await cache.put(scope, stateKey, { complete: inventory }, garbage)) throw new Error('Snapshot promotion failed; previous complete snapshot retained.');
    }
    return { commit: inventory.commit, complete, cached, total: inventory.blobs.length, error: '' };
  } catch (error) {
    const inventory = state.pending ?? state.complete;
    return { commit: request.commit, complete: false, cached: inventory ? await count(inventory) : 0, total: inventory?.blobs.length ?? 0, error: error instanceof Error ? error.message : 'Documents caching interrupted.' };
  }
}

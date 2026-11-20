import { z } from 'zod';
import { readGit, type GitCommit } from './git-reads';
import { Scratch, scratchPath, scratchEntrySchema, gitTreeEntries, type ScratchEntry } from './scratch';

export const agentSnapshotSchema = z.object({ operation: z.literal('agentSnapshot'), id: z.string().uuid(), installationId: z.number().int().positive(), userId: z.number().int().positive(), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), commit: z.string().regex(/^[a-f0-9]{40}$/), directory: z.string().max(512) }).strict();
type Graphql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;
export async function agentTree(repository: string, oid: string, graphql: Graphql): Promise<ScratchEntry[]> {
  const [owner, name] = repository.split('/');
  const value = await graphql('query($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Tree{oid entries{name type mode oid size}}}}}', { owner, name, oid });
  const result = z.object({ data: z.object({ repository: z.object({ object: z.object({ oid: z.literal(oid), entries: z.array(z.object({ name: z.string(), type: z.string(), mode: z.number().int(), oid: z.string(), size: z.number().int().nonnegative() })).max(10000) }) }) }), errors: z.array(z.unknown()).optional() }).parse(value);
  if (result.errors?.length) throw Error('GitHub returned incomplete directory metadata.');
  const entries = result.data.repository.object.entries.map(e => scratchEntrySchema.parse({ ...e, mode: e.mode.toString(8) }));
  if (gitTreeEntries(entries) !== oid || new Set(entries.map(e => e.name)).size !== entries.length) throw Error('Directory integrity mismatch.');
  return entries;
}
export async function agentSnapshot(request: z.infer<typeof agentSnapshotSchema>, api: (path: string, limit?: number) => Promise<unknown>, graphql: Graphql) {
  if (request.directory) scratchPath.parse(request.directory);
  const commit = await readGit({ id: request.id, installationId: request.installationId, repository: request.repository, workspace: 'scratch', operation: 'gitCommit', oid: request.commit }, request.repository, api) as GitCommit;
  let tree = commit.tree.sha;
  let entries = await agentTree(request.repository, tree, graphql);
  for (const part of request.directory ? request.directory.split('/') : []) {
    const entry = entries.find(e => e.name === part && e.type === 'tree');
    if (!entry) throw Error('Selected directory does not exist at this commit.');
    tree = entry.oid; entries = await agentTree(request.repository, tree, graphql);
  }
  const scratch = new Scratch({ version: 1, revision: 0, origin: { repository: request.repository, commit: request.commit, directory: request.directory }, base: { tree, trees: { [tree]: entries } }, files: [], commits: [] });
  scratch.commit(`Open ${request.repository}@${request.commit}:${request.directory || '/'}`, 0, null);
  return scratch.snapshot();
}

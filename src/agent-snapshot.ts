import { z } from 'zod';
import { gitOid, readGit, type GitBlob, type GitCommit, type GitTree } from './git-reads';
import { verifiedGitBlobBytes } from './git-blob';
import { utf8Text } from './utf8';
import { Scratch, scratchPath, validateFiles, type ScratchFile } from './scratch';

export const agentSnapshotSchema = z.object({ operation: z.literal('agentSnapshot'), id: z.string().uuid(), installationId: z.number().int().positive(), userId: z.number().int().positive(), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), commit: z.string().regex(/^[a-f0-9]{40}$/), directory: z.string().max(512) }).strict();
export async function agentSnapshot(request: z.infer<typeof agentSnapshotSchema>, api: (path: string, limit?: number) => Promise<unknown>) {
  gitOid.parse(request.commit); if (request.directory) scratchPath.parse(request.directory);
  const base = { id: request.id, installationId: request.installationId, repository: request.repository, workspace: 'scratch' };
  const commit = await readGit({ ...base, operation: 'gitCommit', oid: request.commit }, request.repository, api) as GitCommit;
  const tree = await readGit({ ...base, operation: 'gitTree', oid: commit.tree.sha }, request.repository, api) as GitTree;
  const prefix = request.directory ? `${request.directory}/` : '';
  if (request.directory && !tree.tree.some(f => f.type === 'tree' && f.path === request.directory)) throw Error('Selected directory does not exist at this commit.');
  const selected = tree.tree.filter(f => f.path.startsWith(prefix) && f.type !== 'tree');
  if (selected.length > 100 || selected.reduce((n, f) => n + (f.size ?? 512 * 1024), 0) > 512 * 1024) throw Error('Choose a smaller directory: scratch imports support 100 files and 512 KiB.');
  if (selected.some(f => f.type !== 'blob' || !['100644', '100755'].includes(f.mode) || (f.size ?? Infinity) > 128 * 1024)) throw Error('Scratch imports support regular UTF-8 text files up to 128 KiB; symlinks and submodules are unsupported.');
  const files: ScratchFile[] = [];
  for (const entry of selected) {
    const blob = await readGit({ ...base, operation: 'gitBlob', oid: entry.sha }, request.repository, api) as GitBlob;
    if (blob.size > 128 * 1024) throw Error('Imported file exceeds 128 KiB.');
    const bytes = verifiedGitBlobBytes(blob), bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? '\uFEFF' : '';
    files.push({ path: entry.path.slice(prefix.length), mode: entry.mode as ScratchFile['mode'], content: bom + utf8Text(bytes) });
  }
  validateFiles(files);
  const scratch = new Scratch({ version: 1, revision: 0, origin: { repository: request.repository, commit: request.commit, directory: request.directory }, files, commits: [] });
  scratch.commit(`Import ${request.repository}@${request.commit}:${request.directory || '/'}`, 0, null);
  return scratch.snapshot();
}

import { z } from 'zod';
import { documentText, type Snapshot, type WorkspaceReader } from './workspaces';
import { gitOid } from '../src/git-reads';

const nativeHash = z.string().regex(/^[0-9a-v]{32}$/);
const file = z.object({ path: nativeHash, size: z.number().int().positive().max(16 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const descriptorSchema = z.object({
  schemaVersion: z.literal(1), format: z.literal('beads-current-head-v1'), workspace: z.string(), collectionId: z.string().uuid(),
  sourceGitCommit: gitOid, storageRoot: nativeHash, doltCommit: nativeHash, root: nativeHash,
  manifest: file.extend({ path: z.literal('manifest'), size: z.number().int().positive().max(64 * 1024) }),
  files: z.array(file).min(1).max(512),
}).strict();

/** Resolve data only; workspace metadata never selects executable engine code. */
export async function selectBeadsServing(reader: WorkspaceReader, source: Snapshot, workspace: string, signal: AbortSignal) {
  const pack = await reader.beadsServingSnapshot();
  signal.throwIfAborted();
  if (!pack) return undefined;
  const entry = pack.tree.tree.find(value => value.path === 'serving.json');
  if (!entry || (entry.size ?? Infinity) > 256 * 1024) throw new Error('Invalid Beads serving descriptor.');
  const descriptor = descriptorSchema.parse(JSON.parse(documentText(await reader.blob(entry, signal))));
  if (descriptor.workspace !== workspace || descriptor.sourceGitCommit !== source.commit) throw new Error('The Beads serving pack is not current for this workspace snapshot. Finish nugs beads sync, then refresh.');
  const originalManifest = source.tree.tree.find(value => value.path === 'manifest');
  const manifest = pack.tree.tree.find(value => value.path === 'manifest');
  if (!originalManifest || !manifest || originalManifest.sha !== manifest.sha || originalManifest.size !== manifest.size || manifest.size !== descriptor.manifest.size) throw new Error('Beads serving manifest does not match its canonical snapshot.');
  const paths = new Set<string>();
  const entries = descriptor.files.map(file => {
    if (paths.has(file.path)) throw new Error('Duplicate Beads serving file.');
    paths.add(file.path);
    const entry = pack.tree.tree.find(value => value.path === file.path);
    if (!entry || entry.size !== file.size || entry.type !== 'blob' || entry.mode !== '100644') throw new Error('Beads serving file is absent or mismatched.');
    return { ...entry, sha256: file.sha256 };
  });
  if (entries.reduce((total, entry) => total + entry.size!, 0) > 64 * 1024 * 1024) throw new Error('Beads current-state pack exceeds the engine’s 64 MiB encoded-data bound.');
  return { descriptor, manifest: { ...manifest, sha256: descriptor.manifest.sha256 }, entries, gitCommit: pack.commit };
}

import type { WorkspaceAppContext } from '../workspace-apps';
import { element } from '../components';
import { documentText } from '../workspaces';
import { WorkspaceReader } from '../workspaces';
import { bridgeRequest } from '../client';

export async function mount(root: HTMLElement, context: WorkspaceAppContext) {
  root.append(element('h2', 'Beads'), element('p', 'The task graph belongs to this workspace’s native Beads/Dolt collection.', 'muted'));
  if (!context.workspace.dolt) { root.append(element('p', 'No Beads snapshot has been published for this workspace.', 'notice')); return; }
  const boundary = element('div', undefined, 'notice');
  boundary.append(element('strong', 'Issue browsing needs the read-only Dolt engine.'), element('p', 'That engine is still being built. The view below inspects authoritative storage metadata; it does not query tasks or substitute archived exports.'));
  const status = element('p', 'Reading Beads storage metadata…'), result = element('dl', undefined, 'metadata');
  root.append(boundary, status, result);
  try {
    const reader = new WorkspaceReader(bridgeRequest, context.connection.id, context.repository, context.connection.installation!.id, context.workspace.name, 'dolt');
    const snapshot = await reader.snapshot(context.workspace.dolt, true);
    const manifest = snapshot.tree.tree.find(entry => entry.path === 'manifest');
    if (!manifest) throw new Error('Dolt snapshot has no manifest.');
    const fields = documentText(await reader.blob(manifest)).split(':');
    if (context.signal.aborted) return;
    if (fields[0] !== '5' || fields[1] !== '__DOLT__' || !/^[0-9a-v]{32}$/.test(fields[3] ?? '')) throw new Error('Unsupported Dolt storage manifest.');
    const files = snapshot.tree.tree.filter(entry => entry.type === 'blob');
    for (const [label, value] of [
      ['Git snapshot', snapshot.commit], ['Storage root', fields[3]], ['Storage files', String(files.length)],
      ['Archive files', String(files.filter(entry => entry.path.endsWith('.darc')).length)],
      ['Snapshot size', `${files.reduce((sum, entry) => sum + (entry.size ?? 0), 0).toLocaleString()} bytes`],
    ]) result.append(element('dt', label), element('dd', value));
    status.textContent = 'Storage manifest verified. Tablefiles have not been downloaded and no issue query has run.';
  } catch (error) { if (!context.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Beads inspection failed.'; }
}

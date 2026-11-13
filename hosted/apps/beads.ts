import type { WorkspaceAppContext } from '../workspace-apps';
import { element } from '../components';

export function mount(root: HTMLElement, context: WorkspaceAppContext) {
  root.append(element('h2', 'Beads'), element('p', 'Run list, ready and blocked queries against this workspace’s native Dolt snapshot.', 'muted'));
  if (!context.workspace.dolt) { root.append(element('p', 'No Beads snapshot has been published for this workspace.', 'notice')); return; }
  const link = element('a', 'Open Beads read sample', 'button');
  link.href = './app/#/beads?' + new URLSearchParams({ connection: context.connection.id, repository: context.repository, workspace: context.workspace.name });
  root.append(link);
}

import type { WorkspaceAppContext } from '../workspace-apps';
import { element, externalLink } from '../components';
import { githubDevURL } from '../github-dev';
import { documents } from '../workspaces';

export function mount(root: HTMLElement, context: WorkspaceAppContext) {
  root.append(element('h2', 'Documents'), element('p', 'Browse this immutable document snapshot in github.dev. A dedicated Monaco review/editing workspace is planned; Beads is the current priority.', 'muted'));
  root.append(externalLink('Open documents in github.dev', githubDevURL(context.repository, context.opened.snapshot.commit)));
  const list = element('ul', undefined, 'document-list');
  for (const entry of documents(context.opened.snapshot)) {
    const row = element('li'), link = externalLink(entry.path.slice('documents/'.length), githubDevURL(context.repository, context.opened.snapshot.commit, entry.path, true));
    link.className = ''; row.append(link); list.append(row);
  }
  root.append(list, element('p', 'github.dev signs in separately. Its Git publishing flow does not perform nugs version-checked custom-ref updates.', 'muted'));
}

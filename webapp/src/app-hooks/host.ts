import { bridgeRequest } from '../../../hosted/client';
import { WorkspaceReader, documents, documentText } from '../../../hosted/workspaces';
import type { HostedConnection } from '../../../src/hosted-protocol';
import type { AppHooksV1, DocumentSnapshotDTO, WorkspaceScope } from './contracts';
import { workspaceNavigationSchema, type WorkspaceNavigation } from '../../../src/workspace-navigation';
import { createHostedReviews } from './reviews';

export function createHostedAppHooks(): AppHooksV1 {
  const snapshots = new Map<string, { reader: WorkspaceReader; entries: ReturnType<typeof documents> }>();
  const reader = (scope: WorkspaceScope) => new WorkspaceReader(bridgeRequest, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
  const navigationKey = () => `github-ultimate-workspace-v1:${location.pathname}`;
  const navigation = {
    async load(): Promise<WorkspaceNavigation | null> {
      try {
        const local = workspaceNavigationSchema.safeParse(JSON.parse(localStorage.getItem(navigationKey()) ?? 'null'));
        if (local.success) return local.data;
      } catch { /* Extension preferences also work when page storage is blocked. */ }
      const remote = await bridgeRequest<unknown>({ operation: 'loadNavigation' });
      if (remote === null) return null;
      return workspaceNavigationSchema.parse(remote);
    },
    async save(value: WorkspaceNavigation) {
      const preference = workspaceNavigationSchema.parse(value);
      try { localStorage.setItem(navigationKey(), JSON.stringify(preference)); } catch { /* Broker still remembers. */ }
      await bridgeRequest({ operation: 'saveNavigation', navigation: preference });
    },
    async forget() {
      try { localStorage.removeItem(navigationKey()); } catch { /* Storage may be unavailable. */ }
      await bridgeRequest({ operation: 'forgetNavigation' });
    },
  };
  return Object.freeze({
    contractVersion: 1,
    modules: Object.freeze({ reviews: createHostedReviews(), documents: Object.freeze({
      version: 1,
      navigation,
      async connect() {
        const support = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' }, 5000);
        if (!['gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'implicitWorkspaces'].every(id => support.capabilities?.includes(id))) throw new Error('Update the extension and reload this page to enable document browsing.');
        const connections = await bridgeRequest<HostedConnection[]>({ operation: 'connections' });
        return connections.filter(connection => connection.installation).map(connection => ({
          id: connection.id, name: connection.name, installationId: connection.installation!.id, account: connection.installation!.account,
        }));
      },
      async discover(scope: Omit<WorkspaceScope, 'workspace'>) {
        const found = await reader({ ...scope, workspace: '' }).discover();
        return found.map(workspace => ({ id: workspace.name, hasDocuments: Boolean(workspace.documents) }));
      },
      async open(scope: WorkspaceScope): Promise<DocumentSnapshotDTO> {
        const activeReader = reader(scope);
        const found = await activeReader.discover();
        const workspace = found.find(item => item.name === scope.workspace);
        if (!workspace) throw new Error('This workspace is no longer available. Discover workspaces again.');
        const opened = await activeReader.open(workspace);
        const entries = documents(opened.snapshot);
        const id = crypto.randomUUID();
        snapshots.set(id, { reader: activeReader, entries });
        return {
          id, commit: opened.snapshot.commit, purpose: opened.manifest.purpose ?? '',
          documents: entries.map(entry => ({ id: entry.sha + ':' + entry.path, path: entry.path.slice('documents/'.length), size: entry.size ?? null })),
        };
      },
      async read(snapshotId: string, documentId: string) {
        const snapshot = snapshots.get(snapshotId);
        const entry = snapshot?.entries.find(item => item.sha + ':' + item.path === documentId);
        if (!snapshot || !entry) throw new Error('Select a document from the current verified snapshot.');
        return documentText(await snapshot.reader.blob(entry));
      },
      dispose() { snapshots.clear(); },
    }) }),
  });
}

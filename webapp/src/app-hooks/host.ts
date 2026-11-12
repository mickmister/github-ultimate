import { bridgeRequest } from '../../../hosted/client';
import { WorkspaceReader, documents, documentText } from '../../../hosted/workspaces';
import type { HostedConnection } from '../../../src/hosted-protocol';
import type { AppHooksV1, DocumentSnapshotDTO, WorkspaceScope } from './contracts';
import { workspaceNavigationSchema, type WorkspaceNavigation } from '../../../src/workspace-navigation';
import { createHostedReviews } from './reviews';
import { createQueryTransport } from '../../../hosted/query-cache';

export function createHostedAppHooks(): AppHooksV1 {
  const snapshots = new Map<string, { reader: WorkspaceReader; cachedReader: WorkspaceReader; entries: ReturnType<typeof documents> }>();
  const queries = createQueryTransport(bridgeRequest);
  let persistent = false;
  const reader = (scope: WorkspaceScope, cached = false) => new WorkspaceReader(cached ? request => queries.transport({ ...request, cacheOnly: true }) : queries.transport, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
  async function open(scope: WorkspaceScope, cached = false): Promise<DocumentSnapshotDTO> {
    if (cached && !persistent) throw new Error('This host does not support persistent workspace reads.');
    const activeReader = reader(scope, cached);
    const workspace = (await activeReader.discover()).find(item => item.name === scope.workspace);
    if (!workspace) throw new Error('This workspace is no longer available. Discover workspaces again.');
    const opened = await activeReader.open(workspace), entries = documents(opened.snapshot);
    const id = JSON.stringify([scope.connectionId, scope.installationId, scope.repository.toLowerCase(), scope.workspace, opened.snapshot.commit]);
    snapshots.set(id, { reader: activeReader, cachedReader: reader(scope, true), entries });
    // Bound live handles; durable objects stay in the host, independent of these.
    if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!);
    return { id, commit: opened.snapshot.commit, purpose: opened.manifest.purpose ?? '', documents: entries.map(entry => ({ id: entry.sha + ':' + entry.path, path: entry.path.slice('documents/'.length), size: entry.size ?? null })) };
  }
  async function read(snapshotId: string, documentId: string, cached: boolean) {
    const snapshot = snapshots.get(snapshotId), entry = snapshot?.entries.find(item => item.sha + ':' + item.path === documentId);
    if (!snapshot || !entry) throw new Error('Select a document from the current verified snapshot.');
    return documentText(await (cached ? snapshot.cachedReader : snapshot.reader).blob(entry));
  }
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
    modules: Object.freeze({ reviews: createHostedReviews(queries.transport), documents: Object.freeze({
      version: 1,
      navigation,
      async connect() {
        const support = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' }, 5000);
        persistent = support.capabilities?.includes('persistedWorkspaceCache') ?? false;
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
      open: (scope: WorkspaceScope) => open(scope),
      restore: (scope: WorkspaceScope) => open(scope, true),
      read: (snapshotId: string, documentId: string) => read(snapshotId, documentId, false),
      readCached: (snapshotId: string, documentId: string) => read(snapshotId, documentId, true),
      dispose() { snapshots.clear(); queries.dispose(); },
    }) }),
  });
}

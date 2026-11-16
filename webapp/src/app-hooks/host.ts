import { bridgeRequest } from '../../../hosted/client';
import { WorkspaceReader, documents, documentText } from '../../../hosted/workspaces';
import type { HostedConnection } from '../../../src/hosted-protocol';
import type { AppHooksV1, DocumentSnapshotDTO, WorkspaceScope } from './contracts';
import { workspaceNavigationSchema, type WorkspaceNavigation } from '../../../src/workspace-navigation';
import { createHostedReviews } from './reviews';
import { createQueryTransport } from '../../../hosted/query-cache';
import { applicationStorage } from '../app-storage';
import type { DocumentCacheStatus } from '../../../src/document-cache';

export function createHostedAppHooks(): AppHooksV1 {
  const snapshots = new Map<string, { reader: WorkspaceReader; cachedReader: WorkspaceReader; entries: ReturnType<typeof documents>; scope: WorkspaceScope; commit: string; live: boolean }>();
  const queries = createQueryTransport(bridgeRequest);
  let persistent = false;
  let completeSnapshots = false;
  const reader = (scope: WorkspaceScope, cached = false) => new WorkspaceReader(cached ? request => queries.transport({ ...request, cacheOnly: true }) : queries.transport, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
  async function open(scope: WorkspaceScope, cached = false): Promise<DocumentSnapshotDTO> {
    if (cached && !persistent) throw new Error('This host does not support persistent workspace reads.');
    const activeReader = reader(scope, cached);
    const restored = cached && completeSnapshots ? await bridgeRequest<DocumentCacheStatus>({ operation: 'documentCache', action: 'restore', id: scope.connectionId, installationId: scope.installationId, repository: scope.repository, workspace: scope.workspace, priority: [] }) : undefined;
    const workspace = restored?.commit ? { name: scope.workspace, documents: restored.commit } : (await activeReader.discover()).find(item => item.name === scope.workspace);
    if (!workspace) throw new Error('This workspace is no longer available. Discover workspaces again.');
    const opened = await activeReader.open(workspace), entries = documents(opened.snapshot);
    const id = JSON.stringify([scope.connectionId, scope.installationId, scope.repository.toLowerCase(), scope.workspace, opened.snapshot.commit]);
    snapshots.set(id, { reader: reader(scope), cachedReader: reader(scope, true), entries, scope, commit: opened.snapshot.commit, live: !cached });
    // Bound live handles; durable objects stay in the host, independent of these.
    if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!);
    return { id, commit: opened.snapshot.commit, purpose: opened.manifest.purpose ?? '', ...(restored ? { cacheState: restored } : {}), documents: entries.map(entry => ({ id: entry.sha + ':' + entry.path, path: entry.path.slice('documents/'.length), size: entry.size ?? null })) };
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
        const local = workspaceNavigationSchema.safeParse(JSON.parse((await applicationStorage()).getItem(navigationKey()) ?? 'null'));
        if (local.success) return local.data;
      } catch { /* Extension preferences also work when page storage is blocked. */ }
      const remote = await bridgeRequest<unknown>({ operation: 'loadNavigation' });
      if (remote === null) return null;
      return workspaceNavigationSchema.parse(remote);
    },
    async save(value: WorkspaceNavigation) {
      const preference = workspaceNavigationSchema.parse(value);
      try { const storage = await applicationStorage(); storage.setItem(navigationKey(), JSON.stringify(preference)); await storage.flush(); } catch { /* Broker still remembers. */ }
      await bridgeRequest({ operation: 'saveNavigation', navigation: preference });
    },
    async forget() {
      try { const storage = await applicationStorage(); storage.removeItem(navigationKey()); await storage.flush(); } catch { /* Storage may be unavailable. */ }
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
        completeSnapshots = support.capabilities?.includes('documentSnapshots') ?? false;
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
      async cache(snapshotId: string, priority: () => string[], progress: (status: DocumentCacheStatus) => void, signal: AbortSignal) {
        if (!completeSnapshots) return;
        const snapshot = snapshots.get(snapshotId);
        // A stale preview must never replace a newer interrupted inventory.
        if (!snapshot?.live) return;
        const { scope, commit, entries } = snapshot;
        while (!signal.aborted) {
          const selected = priority().map(id => id.split(':')[0]);
          const reviews = entries.filter(entry => /^documents\/review-requests\/[^/]+\/(request\.json|forms\/)/.test(entry.path)).map(entry => entry.sha);
          const status = await bridgeRequest<DocumentCacheStatus>({ operation: 'documentCache', action: 'fill', id: scope.connectionId, installationId: scope.installationId, repository: scope.repository, workspace: scope.workspace, commit, priority: [...new Set([...selected, ...reviews])].slice(0, 100) }, 120000);
          if (signal.aborted) return;
          progress(status);
          if (status.complete || status.error) return;
          // Yield between bounded host calls so foreground document reads take priority.
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      },
      dispose() { snapshots.clear(); queries.dispose(); },
    }) }),
  });
}

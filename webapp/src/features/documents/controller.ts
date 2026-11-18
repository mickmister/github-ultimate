import type { AppHooksV1, WorkspaceScope } from '../../app-hooks/contracts';
import type { DocumentBrowserActions, DocumentBrowserModel } from './contracts';
import { isMarkdown } from './document-format';
import { ancestorFolders } from './document-tree';
import { defaultTreeAppearance, type TreeAppearance } from './tree-appearance';
import type { DocumentLocation } from './navigation';
import { resolveLinkConnection } from '../../../../hosted/connection-link';

const validRepository = (value: string) => /^(?!\.{1,2}\/)[a-zA-Z0-9_.-]+\/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 220;

export function createDocumentBrowserController(appHooks: AppHooksV1, treeAppearance: TreeAppearance = defaultTreeAppearance) {
  if (appHooks.contractVersion !== 1 || appHooks.modules.documents.version !== 1) throw new Error('Incompatible document browser host.');
  const api = appHooks.modules.documents;
  const listeners = new Set<() => void>();
  let generation = 0, disposed = false;
  let savedNavigation = '';
  let remembering = true;
  let state: DocumentBrowserModel = {
    connections: [], connectionId: '', repository: '', workspaces: [], workspaceId: '',
    snapshot: null, documentId: '', query: '', expandedFolders: [], treeAppearance, content: null, documentMode: 'source', documentFullscreen: false, busy: false, error: null,
    status: 'Connect to your approved host to browse workspace documents.', canDiscover: false, canBrowse: false,
  };
  function patch(next: Partial<DocumentBrowserModel>) {
    if (disposed) return;
    const value = { ...state, ...next };
    state = Object.freeze({ ...value,
      canDiscover: !value.busy && Boolean(value.connectionId) && validRepository(value.repository.trim()),
      canBrowse: !value.busy && Boolean(value.connectionId) && value.workspaces.some(workspace => workspace.id === value.workspaceId && workspace.hasDocuments),
    });
    listeners.forEach(listener => listener());
    if (remembering && !state.busy && state.snapshot && api.navigation) {
      const connection = state.connections.find(item => item.id === state.connectionId);
      if (!connection) return;
      const document = state.snapshot.documents.find(item => item.id === state.documentId);
      const navigation = { connectionId: connection.id, installationId: connection.installationId, repository: state.repository.trim(), workspace: state.workspaceId, ...(document ? { documentId: document.id, documentPath: document.path } : {}) };
      const serialized = JSON.stringify(navigation);
      if (serialized !== savedNavigation) {
        savedNavigation = serialized;
        void api.navigation.save(navigation).catch(() => { /* Browsing remains usable; page-local preference is retained when available. */ });
      }
    }
  }
  const emptyDocuments = { snapshot: null, documentId: '', query: '', expandedFolders: [], content: null, documentMode: 'source', documentFullscreen: false } as const;
  function invalidate(next: Partial<DocumentBrowserModel>) {
    generation++;
    patch({ busy: false, error: null, ...next });
  }
  async function run(message: string, work: (isCurrent: () => boolean) => Promise<Partial<DocumentBrowserModel>>) {
    const current = ++generation;
    patch({ busy: true, error: null, status: message });
    try {
      const result = await work(() => !disposed && current === generation);
      if (current === generation) patch({ ...result, busy: false });
    } catch (error) {
      if (current === generation) {
        const message = error instanceof Error ? error.message : 'Document request failed.';
        const denied = /access denied|HTTP (401|403|404)|no approved|not approved|sign in|installation changed|access changed|workspace is no longer available|linked workspace is unavailable/i.test(message);
        const missingDocument = /not in this workspace snapshot|saved document is no longer available/i.test(message);
        patch({ busy: false, ...(denied ? emptyDocuments : missingDocument ? { content: null } : {}), error: message, status: missingDocument ? 'Document unavailable; choose another document from this snapshot.' : !denied && state.snapshot ? 'Cached snapshot retained; refresh failed. It may be out of date.' : 'Request failed. Retry or choose another connection.' });
      }
    }
  }
  async function preview(selected: WorkspaceScope, isCurrent: () => boolean, documentId?: string, documentPath?: string) {
    if (!api.restore) return;
    try {
      const snapshot = await api.restore(selected);
      if (!isCurrent()) return;
      const document = documentPath ? snapshot.documents.find(item => item.path === documentPath) : snapshot.documents.find(item => item.id === documentId);
      patch({ snapshot, workspaceId: selected.workspace, workspaces: [{ id: selected.workspace, hasDocuments: true }], status: 'Showing persisted snapshot while checking for updates…' });
      if (document) {
        const content = await (api.readCached ?? api.read)(snapshot.id, document.id);
        if (isCurrent()) patch({ content, documentId: document.id, expandedFolders: ancestorFolders(document.path), documentMode: isMarkdown(document.path) ? 'markdown' : 'source', documentFullscreen: true });
      }
    } catch { /* A partial/evicted cache is a miss; the foreground network read follows. */ }
  }
  function scope() {
    const connection = state.connections.find(item => item.id === state.connectionId);
    if (!connection || !validRepository(state.repository.trim())) throw new Error('Choose an approved connection and a valid owner/repository.');
    return { connectionId: connection.id, installationId: connection.installationId, repository: state.repository.trim(), workspace: state.workspaceId };
  }
  const actions = Object.freeze<DocumentBrowserActions & { openLocation(location: DocumentLocation): void }>({
    refresh() {
      if (disposed || state.busy || !state.snapshot) return;
      const selected = scope(), previous = state.snapshot;
      const path = previous.documents.find(document => document.id === state.documentId)?.path;
      void run('Checking workspace for updates…', async isCurrent => {
        const snapshot = await api.open(selected);
        if (!isCurrent()) return {};
        const document = path ? snapshot.documents.find(document => document.path === path) : undefined;
        if (!document) return { snapshot, documentId: '', content: null, status: 'Workspace refreshed. Choose a document.' };
        // Do not associate bytes from an older OID with the refreshed tree.
        if (document.id !== state.documentId) patch({ snapshot, documentId: document.id, content: null });
        const content = await api.read(snapshot.id, document.id);
        return { snapshot, documentId: document.id, content, status: 'Workspace checked; document bytes verified.' };
      });
    },
    openLocation(location) {
      if (disposed) return;
      const { connection, repository, workspace, documentId } = location;
      if (!connection && !repository && !workspace && !documentId) { invalidate(emptyDocuments); actions.connect(); return; }
      const resolvedId = connection ?? (state.connections.length === 1 ? state.connections[0].id : undefined);
      if (state.snapshot && resolvedId === state.connectionId && repository === state.repository && workspace === state.workspaceId) {
        if (!documentId) { invalidate({ documentFullscreen: false }); return; }
        if (documentId === state.documentId && state.content !== null) { invalidate({ documentFullscreen: true }); return; }
        if (state.snapshot.documents.some(document => document.id === documentId)) { actions.selectDocument(documentId); return; }
        invalidate({ ...emptyDocuments, error: 'The linked document is not in this workspace snapshot.', status: 'Document not found.' });
        return;
      }
      patch({ ...emptyDocuments, connectionId: '', repository: repository ?? '', workspaceId: '', workspaces: [] });
      void run('Restoring workspace document link…', async isCurrent => {
        if (!repository || !workspace || !validRepository(repository)) throw new Error('This document link needs a valid repository and workspace. Choose the workspace below to continue.');
        const connections = state.connections.length ? state.connections : await api.connect();
        if (!isCurrent()) return {};
        patch({ connections });
        const approved = resolveLinkConnection(connection, connections);
        const selected = { connectionId: approved.id, installationId: approved.installationId, repository, workspace };
        patch({ connectionId: approved.id });
        await preview(selected, isCurrent, documentId);
        if (!isCurrent()) return {};
        const workspaces = await api.discover(selected);
        if (!isCurrent()) return {};
        if (!workspaces.some(item => item.id === workspace && item.hasDocuments)) throw new Error('The linked workspace is unavailable or has no documents.');
        patch({ workspaces, workspaceId: workspace });
        const snapshot = await api.open(selected);
        if (!isCurrent()) return {};
        const document = documentId ? snapshot.documents.find(item => item.id === documentId) : undefined;
        const restored = { connections, connectionId: approved.id, repository, workspaces, workspaceId: workspace, snapshot };
        patch(restored);
        if (documentId && !document) throw new Error('The linked document is not in this workspace snapshot.');
        if (!document) return { ...restored, status: `${snapshot.documents.length} document(s) in the verified snapshot.` };
        patch({ documentId, expandedFolders: ancestorFolders(document.path), documentMode: isMarkdown(document.path) ? 'markdown' : 'source', documentFullscreen: true });
        return { content: await api.read(snapshot.id, document.id), status: 'Document bytes verified against the Git blob.' };
      });
    },
    connect() {
      if (state.busy || disposed) return;
      patch({ connections: [], connectionId: '', workspaces: [], workspaceId: '', ...emptyDocuments });
      void run('Connecting to host…', async isCurrent => {
        const connections = await api.connect();
        if (!isCurrent()) return {};
        patch({ connections });
        const saved = await api.navigation?.load();
        if (!isCurrent()) return {};
        if (saved) {
          patch({ connectionId: saved.connectionId, repository: saved.repository, status: 'Restoring your last workspace…' });
          const approved = connections.find(item => item.id === saved.connectionId && item.installationId === saved.installationId);
          if (!approved) throw new Error('Your saved connection or installation is unavailable. Choose a connection explicitly; no fallback was used.');
          await preview(saved, isCurrent, saved.documentId, saved.documentPath);
          if (!isCurrent()) return {};
          const snapshot = await api.open(saved);
          if (!isCurrent()) return {};
          const workspaceState = { connectionId: saved.connectionId, repository: saved.repository, workspaceId: saved.workspace, workspaces: [{ id: saved.workspace, hasDocuments: true }], snapshot };
          patch(workspaceState);
          const document = saved.documentPath ? snapshot.documents.find(item => item.path === saved.documentPath) : snapshot.documents.find(item => item.id === saved.documentId);
          if ((saved.documentId || saved.documentPath) && !document) throw new Error('Your last workspace is open, but the saved document is no longer available. Choose another document.');
          if (document) {
            patch({ documentId: document.id, expandedFolders: ancestorFolders(document.path), documentMode: isMarkdown(document.path) ? 'markdown' : 'source', documentFullscreen: true });
            return { ...workspaceState, content: await api.read(snapshot.id, document.id), status: 'Last workspace and document restored and verified.' };
          }
          return { ...workspaceState, status: 'Last workspace restored and verified. Choose a document.' };
        }
        return { connections, connectionId: connections.length === 1 ? connections[0].id : '', status: connections.length ? 'Connected. Choose a repository and discover workspaces.' : 'No approved signed-in connections. Open extension connection settings or Alohak native settings to sign in and approve this deployment.' };
      });
    },
    forgetWorkspace() {
      remembering = false;
      savedNavigation = '';
      invalidate({ connectionId: '', repository: '', workspaceId: '', workspaces: [], ...emptyDocuments, status: 'Saved workspace forgotten. Choose a workspace to start again.' });
      void run('Forgetting saved workspace…', async () => {
        await api.navigation?.forget();
        return { status: 'Saved workspace forgotten. Choose a workspace to start again.' };
      });
    },
    selectConnection(id) {
      remembering = true;
      if (id && !state.connections.some(connection => connection.id === id)) return;
      invalidate({ connectionId: id, workspaces: [], workspaceId: '', ...emptyDocuments, status: 'Connection selected. Discover its workspaces.' });
    },
    setRepository(repository) {
      remembering = true;
      invalidate({ repository, workspaces: [], workspaceId: '', ...emptyDocuments, status: 'Repository changed. Discover its workspaces.' });
    },
    discoverWorkspaces() {
      if (!state.canDiscover || disposed) return;
      const selected = scope();
      patch({ workspaces: [], workspaceId: '', ...emptyDocuments });
      void run('Discovering workspaces…', async () => {
        const workspaces = await api.discover(selected);
        return { workspaces, status: workspaces.length ? `${workspaces.length} workspace(s) found. Choose one to browse documents.` : 'No workspace namespaces found in this repository.' };
      });
    },
    selectWorkspace(id) {
      if (id && !state.workspaces.some(workspace => workspace.id === id)) return;
      invalidate({ workspaceId: id, ...emptyDocuments, status: 'Workspace selected. Browse documents to verify its manifest.' });
    },
    browseDocuments() {
      if (!state.canBrowse || disposed) return;
      const selected = scope();
      patch(emptyDocuments);
      void run('Verifying workspace manifest and document snapshot…', async isCurrent => {
        await preview(selected, isCurrent);
        if (!isCurrent()) return {};
        const snapshot = await api.open(selected);
        return { snapshot, status: `${snapshot.documents.length} document(s) in the verified snapshot.` };
      });
    },
    setQuery(query) { patch({ query }); },
    setExpandedFolders(paths) {
      if (state.query.trim()) return; // Search expansion is temporary, preserving the user's browsing state.
      const valid = new Set(state.snapshot?.documents.flatMap(document => ancestorFolders(document.path)) ?? []);
      patch({ expandedFolders: [...new Set(paths.filter(path => valid.has(path)))] });
    },
    setTreeAppearance(appearance) {
      if (!['comfortable', 'compact'].includes(appearance.density) || !['default', 'blue', 'teal'].includes(appearance.accent)) return;
      patch({ treeAppearance: Object.freeze({ density: appearance.density, accent: appearance.accent }) });
    },
    selectDocument(id) {
      const document = state.snapshot?.documents.find(document => document.id === id);
      if (disposed || !state.snapshot || !document) return;
      const snapshot = state.snapshot;
      patch({ documentId: id, expandedFolders: [...new Set([...state.expandedFolders, ...ancestorFolders(document.path)])], content: null, documentMode: isMarkdown(document.path) ? 'markdown' : 'source', documentFullscreen: true });
      void run('Reading and verifying document…', async isCurrent => {
        try { const content = await api.readCached?.(snapshot.id, id); if (content !== undefined && isCurrent()) patch({ content, status: 'Showing persisted document while checking access…' }); } catch { /* Cache miss. */ }
        return { content: await api.read(snapshot.id, id), status: 'Document bytes verified against the Git blob.' };
      });
    },
    setDocumentMode(documentMode) {
      if (disposed || state.content === null) return;
      const document = state.snapshot?.documents.find(document => document.id === state.documentId);
      if (!document || documentMode === 'markdown' && !isMarkdown(document.path)) return;
      patch({ documentMode });
    },
    setDocumentFullscreen(documentFullscreen) {
      if (disposed || !state.snapshot?.documents.some(document => document.id === state.documentId)) return;
      patch({ documentFullscreen });
    },
  });
  return {
    actions,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; generation++; listeners.clear(); api.dispose(); },
  };
}

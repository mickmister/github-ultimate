import type { AppHooksV1 } from '../../app-hooks/contracts';
import type { DocumentBrowserActions, DocumentBrowserModel } from './contracts';
import { isMarkdown } from './document-format';
import { ancestorFolders } from './document-tree';
import { defaultTreeAppearance, type TreeAppearance } from './tree-appearance';
import type { DocumentLocation } from './navigation';

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
    status: 'Connect to your approved extension to browse workspace documents.', canDiscover: false, canBrowse: false,
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
      if (current === generation) patch({ busy: false, content: null, error: error instanceof Error ? error.message : 'Document request failed.', status: 'Request failed. Retry or choose another connection.' });
    }
  }
  function scope() {
    const connection = state.connections.find(item => item.id === state.connectionId);
    if (!connection || !validRepository(state.repository.trim())) throw new Error('Choose an approved connection and a valid owner/repository.');
    return { connectionId: connection.id, installationId: connection.installationId, repository: state.repository.trim(), workspace: state.workspaceId };
  }
  const actions = Object.freeze<DocumentBrowserActions & { openLocation(location: DocumentLocation): void }>({
    openLocation(location) {
      if (disposed) return;
      const { connection, repository, workspace, documentId } = location;
      if (!connection && !repository && !workspace && !documentId) { invalidate(emptyDocuments); actions.connect(); return; }
      if (state.snapshot && connection === state.connectionId && repository === state.repository && workspace === state.workspaceId) {
        if (!documentId) { invalidate({ documentFullscreen: false }); return; }
        if (documentId === state.documentId && state.content !== null) { invalidate({ documentFullscreen: true }); return; }
        if (state.snapshot.documents.some(document => document.id === documentId)) { actions.selectDocument(documentId); return; }
        invalidate({ ...emptyDocuments, error: 'The linked document is not in this workspace snapshot.', status: 'Document not found.' });
        return;
      }
      patch({ ...emptyDocuments, connectionId: '', repository: repository ?? '', workspaceId: '', workspaces: [] });
      void run('Restoring workspace document link…', async isCurrent => {
        if (!connection || !repository || !workspace || !validRepository(repository)) throw new Error('This document link needs a connection, valid repository and workspace. Choose the workspace below to continue.');
        const connections = state.connections.length ? state.connections : await api.connect();
        if (!isCurrent()) return {};
        patch({ connections });
        const approved = connections.find(item => item.id === connection);
        if (!approved) throw new Error('The linked connection is not approved on this device. Open extension connection settings or choose another connection.');
        const selected = { connectionId: approved.id, installationId: approved.installationId, repository, workspace };
        patch({ connectionId: approved.id });
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
      void run('Connecting to extension…', async isCurrent => {
        const connections = await api.connect();
        if (!isCurrent()) return {};
        patch({ connections });
        const saved = await api.navigation?.load();
        if (!isCurrent()) return {};
        if (saved) {
          patch({ connectionId: saved.connectionId, repository: saved.repository, status: 'Restoring your last workspace…' });
          const approved = connections.find(item => item.id === saved.connectionId && item.installationId === saved.installationId);
          if (!approved) throw new Error('Your saved connection or installation is unavailable. Choose a connection explicitly; no fallback was used.');
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
        return { connections, connectionId: connections.length === 1 ? connections[0].id : '', status: connections.length ? 'Connected. Choose a repository and discover workspaces.' : 'No approved signed-in connections. Open extension connection settings to sign in and approve this origin.' };
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
      void run('Verifying workspace manifest and document snapshot…', async () => {
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
      void run('Reading and verifying document…', async () => ({ content: await api.read(snapshot.id, id), status: 'Document bytes verified against the Git blob.' }));
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

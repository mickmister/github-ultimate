import type { AppHooksV1 } from '../../app-hooks/contracts';
import type { DocumentBrowserActions, DocumentBrowserModel } from './contracts';
import { isMarkdown } from './document-format';

const validRepository = (value: string) => /^(?!\.{1,2}\/)[a-zA-Z0-9_.-]+\/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 220;

export function createDocumentBrowserController(appHooks: AppHooksV1) {
  if (appHooks.contractVersion !== 1 || appHooks.modules.documents.version !== 1) throw new Error('Incompatible document browser host.');
  const api = appHooks.modules.documents;
  const listeners = new Set<() => void>();
  let generation = 0, disposed = false;
  let state: DocumentBrowserModel = {
    connections: [], connectionId: '', repository: 'mickmister/workspace-storage', workspaces: [], workspaceId: '',
    snapshot: null, documentId: '', query: '', content: null, documentMode: 'source', busy: false, error: null,
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
  }
  const emptyDocuments = { snapshot: null, documentId: '', query: '', content: null, documentMode: 'source' } as const;
  function invalidate(next: Partial<DocumentBrowserModel>) {
    generation++;
    patch({ busy: false, error: null, ...next });
  }
  async function run(message: string, work: () => Promise<Partial<DocumentBrowserModel>>) {
    const current = ++generation;
    patch({ busy: true, error: null, status: message });
    try {
      const result = await work();
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
  const actions = Object.freeze<DocumentBrowserActions>({
    connect() {
      if (state.busy || disposed) return;
      patch({ connections: [], connectionId: '', workspaces: [], workspaceId: '', ...emptyDocuments });
      void run('Connecting to extension…', async () => {
        const connections = await api.connect();
        return { connections, connectionId: connections.length === 1 ? connections[0].id : '', status: connections.length ? 'Connected. Choose a repository and discover workspaces.' : 'No approved signed-in connections. Open extension connection settings to sign in and approve this origin.' };
      });
    },
    selectConnection(id) {
      if (id && !state.connections.some(connection => connection.id === id)) return;
      invalidate({ connectionId: id, workspaces: [], workspaceId: '', ...emptyDocuments, status: 'Connection selected. Discover its workspaces.' });
    },
    setRepository(repository) {
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
    selectDocument(id) {
      const document = state.snapshot?.documents.find(document => document.id === id);
      if (disposed || !state.snapshot || !document) return;
      const snapshot = state.snapshot;
      patch({ documentId: id, content: null, documentMode: isMarkdown(document.path) ? state.documentMode : 'source' });
      void run('Reading and verifying document…', async () => ({ content: await api.read(snapshot.id, id), status: 'Document bytes verified against the Git blob.' }));
    },
    setDocumentMode(documentMode) {
      if (disposed || state.content === null) return;
      const document = state.snapshot?.documents.find(document => document.id === state.documentId);
      if (!document || documentMode === 'markdown' && !isMarkdown(document.path)) return;
      patch({ documentMode });
    },
  });
  return {
    actions,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; generation++; listeners.clear(); api.dispose(); },
  };
}

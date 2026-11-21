import type { AppHooksV1, ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing } from '../../app-hooks/reviews';

export interface HomeSource {
  id: string;
  parent?: string;
  kind: 'connection' | 'repository' | 'workspace';
  connection: ConnectionDTO;
  repository?: string;
  scope?: WorkspaceScope;
  busy: boolean;
  error: string;
  listing?: ReviewListing;
}
export interface HomeState {
  busy: boolean;
  error: string;
  connections: readonly ConnectionDTO[];
  sources: readonly HomeSource[];
  canEnumerate: boolean;
  supported: boolean;
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createHomeController(hooks: AppHooksV1) {
  let state: HomeState = { busy: false, error: '', connections: [], sources: [], canEnumerate: Boolean(hooks.modules.documents.repositories), supported: Boolean(hooks.modules.reviews) };
  const listeners = new Set<() => void>();
  let disposed = false, epoch = 0;
  const versions = new Map<string, number>();
  const publish = (patch: Partial<HomeState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  function removeChildren(id: string) {
    const removed = new Set([id]);
    let size = 0;
    while (size !== removed.size) {
      size = removed.size;
      for (const source of state.sources) if (source.parent && removed.has(source.parent)) removed.add(source.id);
    }
    for (const key of removed) versions.set(key, (versions.get(key) ?? 0) + 1);
    publish({ sources: state.sources.filter(source => source.id === id || !removed.has(source.id)) });
  }
  function put(source: HomeSource) {
    publish({ sources: [...state.sources.filter(item => item.id !== source.id), source] });
  }
  async function load(source: HomeSource) {
    if (disposed) return;
    removeChildren(source.id);
    const token = (versions.get(source.id) ?? 0) + 1, generation = epoch;
    versions.set(source.id, token);
    const current = () => !disposed && generation === epoch && versions.get(source.id) === token;
    const active = { ...source, busy: true, error: '', listing: undefined };
    put(active);
    try {
      if (source.kind === 'workspace') {
        const listing = await hooks.modules.reviews!.list(source.scope!);
        if (current()) put({ ...active, busy: false, listing });
      } else if (source.kind === 'repository') {
        const scope = { connectionId: source.connection.id, installationId: source.connection.installationId, repository: source.repository! };
        const found = await hooks.modules.documents.discover(scope);
        if (!current()) return;
        put({ ...active, busy: false });
        for (const workspace of found.filter(item => item.hasDocuments)) {
          const next = { ...scope, workspace: workspace.id };
          void load({ id: JSON.stringify(['workspace', next]), parent: source.id, kind: 'workspace', connection: source.connection, repository: source.repository, scope: next, busy: false, error: '' });
        }
      } else {
        const found = await hooks.modules.documents.repositories!(source.connection.id);
        if (!current()) return;
        put({ ...active, busy: false });
        for (const repository of found) addRepository(source.connection, repository.fullName, source.id);
      }
    } catch (cause) { if (current()) put({ ...active, busy: false, error: message(cause) }); }
  }
  function addRepository(connection: ConnectionDTO, repository: string, parent?: string) {
    const id = JSON.stringify(['repository', connection.id, connection.installationId, repository.toLowerCase()]);
    if (state.sources.some(source => source.id === id)) return;
    void load({ id, parent, kind: 'repository', connection, repository, busy: false, error: '' });
  }
  async function connect() {
    if (disposed) return;
    const generation = ++epoch;
    versions.clear();
    publish({ busy: true, error: '', connections: [], sources: [] });
    try {
      const connections = await hooks.modules.documents.connect();
      if (disposed || generation !== epoch) return;
      publish({ busy: false, connections });
      if (state.supported && state.canEnumerate) for (const connection of connections) {
        void load({ id: JSON.stringify(['connection', connection.id, connection.installationId]), kind: 'connection', connection, busy: false, error: '' });
      }
    } catch (cause) { if (!disposed && generation === epoch) publish({ busy: false, error: message(cause) }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    actions: {
      connect,
      retry(id: string) { const source = state.sources.find(item => item.id === id); if (source && !source.busy) void load(source); },
      addRepository(connectionId: string, repository: string) {
        const connection = state.connections.find(item => item.id === connectionId);
        if (connection && !state.canEnumerate && state.supported && /^[^/\s]+\/[^/\s]+$/.test(repository.trim())) addRepository(connection, repository.trim());
      },
    },
    dispose() { disposed = true; epoch++; listeners.clear(); hooks.modules.documents.dispose(); },
  };
}

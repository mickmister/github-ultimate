import { openBeadsSample, type BeadsResult, type BeadsSession } from './beads-sample';
import type { PiBridge } from './pi-transport';
import type { HostedConnection } from '../src/hosted-protocol';
import type { ChatWorkspace } from './pi-chat-contract';
import { beadsQuerySchema, queryBeads, type BeadsQuery } from '../src/beads-query';

export type PiBeadsSnapshot = { phase: 'loading' | 'ready' | 'error'; results: BeadsResult[]; error: string; workspace: ChatWorkspace };
export interface PiBeadsHandle {
  snapshot(): PiBeadsSnapshot;
  subscribe(listener: () => void): () => void;
  query(input: BeadsQuery, signal?: AbortSignal): Promise<Record<string, unknown>>;
  refresh(): void;
}
const key = (workspace: ChatWorkspace) => JSON.stringify([workspace.repository.toLowerCase(), workspace.workspace]);
function wait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? Error('Beads request cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** One workspace-owned load. Queries wait for it; chat create/restore never do. */
export class PiBeads {
  private active?: { key: string; handle: PiBeadsHandle; dispose(): void };
  constructor(private send: PiBridge, private open = openBeadsSample) {}
  select(workspace?: ChatWorkspace, connectionId?: string): PiBeadsHandle | undefined {
    const scope = workspace && key(workspace) + (connectionId ?? '');
    if (this.active?.key === scope) return this.active?.handle;
    this.active?.dispose(); this.active = undefined;
    if (!workspace) return;
    let state: PiBeadsSnapshot = { phase: 'loading', results: [], error: '', workspace };
    const listeners = new Set<() => void>();
    let controller = new AbortController(), session: BeadsSession | undefined, stopped = false;
    const publish = (next: PiBeadsSnapshot) => { state = next; for (const listener of listeners) listener(); };
    const load = async () => {
      const signal = controller.signal;
      try {
        const connections = await this.send<HostedConnection[]>({ operation: 'connections' });
        const matches: HostedConnection[] = [];
        for (const connection of connections.filter(value => value.installation && (!connectionId || value.id === connectionId))) {
          const repositories = await this.send<{ full_name: string }[]>({ operation: 'repositories', id: connection.id });
          signal.throwIfAborted();
          if (repositories.some(repo => repo.full_name.toLowerCase() === workspace.repository.toLowerCase())) matches.push(connection);
        }
        if (matches.length !== 1) throw Error('Choose one approved GitHub connection for this workspace.');
        const connection = matches[0];
        const opened = await this.open({ connectionId: connection.id, installationId: connection.installation!.id, ...workspace }, signal, () => {}, this.send);
        if (stopped || signal.aborted) { opened.dispose(); signal.throwIfAborted(); throw Error('Workspace changed.'); }
        session = opened;
        const proof = await opened.state();
        if (!proof.putRejected || !proof.commitRejected || !proof.sealed) throw Error('Beads did not open a sealed read-only snapshot.');
        const results: BeadsResult[] = [];
        for (const operation of ['list', 'ready', 'blocked'] as const) results.push(await opened.query(operation));
        signal.throwIfAborted();
        publish({ phase: 'ready', results, error: '', workspace });
        return opened;
      } catch (error) {
        if (!stopped && !signal.aborted) { session?.dispose(); session = undefined; publish({ phase: 'error', results: [], error: error instanceof Error ? error.message : 'Beads could not be loaded.', workspace }); }
        throw error;
      }
    };
    let pending = load(); void pending.catch(() => {});
    const handle: PiBeadsHandle = {
      snapshot: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      refresh() {
        if (stopped) return;
        controller.abort(); session?.dispose(); session = undefined; controller = new AbortController();
        publish({ phase: 'loading', results: [], error: '', workspace }); pending = load(); void pending.catch(() => {});
      },
      async query(input, signal) {
        const request = beadsQuerySchema.parse(input);
        if (stopped) throw Error('Beads workspace changed.');
        if (request.operation === 'refresh') handle.refresh();
        const owner = controller.signal;
        const opened = await wait(wait(pending, owner), signal);
        if (stopped || owner.aborted || state.phase !== 'ready') throw Error('Beads workspace changed; retry in the current workspace.');
        const identity = { ...workspace, gitCommit: opened.gitCommit, doltCommit: opened.doltCommit, servingCommit: opened.servingCommit };
        if (request.operation === 'refresh') return { ...identity, refreshed: true };
        const operation = request.operation === 'show' ? 'list' : request.operation;
        return { ...identity, ...queryBeads(state.results.find(result => result.operation === operation)?.issues ?? [], request) };
      },
    };
    this.active = { key: scope!, handle, dispose() { stopped = true; controller.abort(); session?.dispose(); listeners.clear(); } };
    return handle;
  }
  async query(workspace: ChatWorkspace | undefined, input: BeadsQuery, signal?: AbortSignal) {
    if (!workspace || !this.active || key(this.active.handle.snapshot().workspace) !== key(workspace)) throw Error('Select the current conversation workspace before querying Beads.');
    return this.active.handle.query(input, signal);
  }
}

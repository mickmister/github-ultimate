import { useEffect, useRef, useState } from 'react';
import { bridgeRequest } from '../../../../hosted/client';
import { openBeadsSample, type BeadsResult, type BeadsSession } from '../../../../hosted/beads-sample';
import type { HostedConnection } from '../../../../src/hosted-protocol';
import { WorkspaceReader } from '../../../../hosted/workspaces';
import { applicationStorage } from '../../app-storage';
import { lastWorkspaceKey, readWorkspace, validWorkspace, workspaceChoice, type WorkspaceChoice } from './preferences';
import { settingsError } from './settings-error';
import { useBeadsBoardFeature } from './BeadsBoard.hooks';
import { copy } from './Beads.copy';

const services = {
  connections: () => bridgeRequest<HostedConnection[]>({ operation: 'connections' }),
  async discover(choice: WorkspaceChoice, installationId: number) {
    const reader = new WorkspaceReader(bridgeRequest, choice.connection, choice.repository, installationId);
    return (await reader.discover()).filter(value => value.dolt && value.documents).map(value => value.name);
  },
  open: openBeadsSample, storage: applicationStorage,
};
export type BeadsServices = typeof services;
export type BeadsNavigation = { read(): URLSearchParams; write(choice: WorkspaceChoice): void; subscribe(listener: () => void): () => void };
// Fixture/non-router entry point. Production supplies the TanStack adapter.
export const browserNavigation: BeadsNavigation = {
  read: () => new URLSearchParams(location.hash.split('?')[1] ?? location.search),
  write(choice) { const url = new URL(location.href); const params = this.read(); Object.entries(choice).forEach(([key, value]) => params.set(key, value)); url.hash = '/beads?' + params; history.replaceState(history.state, '', url); },
  subscribe(listener) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); },
};
export function useBeadsFeature(host: BeadsServices = services, navigation = browserNavigation) {
  const [connections, setConnections] = useState<HostedConnection[]>([]);
  const [choice, setChoice] = useState<WorkspaceChoice>({ connection: '', repository: '', workspace: '' });
  const [loadedChoice, setLoadedChoice] = useState<WorkspaceChoice>();
  const [workspaces, setWorkspaces] = useState<string[]>([]), [status, setStatus] = useState<string>(copy.connecting);
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [editing, setEditing] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [results, setResults] = useState<BeadsResult[]>([]);
  const active = useRef<{ controller: AbortController; session?: BeadsSession } | undefined>(undefined), epoch = useRef(0);
  const activeScope = useRef('');
  const storage = useRef<Awaited<ReturnType<typeof applicationStorage>> | undefined>(undefined);
  function reset() {
    epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); active.current = undefined;
    activeScope.current = '';
    setResults([]); setLoadedChoice(undefined); setBusy(false); setError('');
  }
  async function load(value: WorkspaceChoice, available = connections) {
    const selected = available.find(connection => connection.id === value.connection);
    if (!validWorkspace(value) || !selected?.installation) { setEditing(true); setError(copy.approvedWorkspace); return; }
    reset(); const attempt = epoch.current, controller = new AbortController(); active.current = { controller };
    activeScope.current = JSON.stringify(value);
    setBusy(true); setEditing(false); setLoadedChoice(value); setStatus(copy.loading);
    // Remember the explicit choice independently of the network operation. It is
    // restored only after checking the host's current approved connections.
    if (storage.current) try {
      const serialized = JSON.stringify(value);
      if (storage.current.getItem(lastWorkspaceKey) !== serialized) {
        storage.current.setItem(lastWorkspaceKey, serialized);
        void storage.current.flush().then(() => { if (attempt === epoch.current) setPreferencesError(''); })
          .catch(reason => { if (attempt === epoch.current) setPreferencesError(settingsError('Workspace', reason)); });
      }
    } catch (reason) { setPreferencesError(settingsError('Workspace', reason)); }
    try {
      const opened = await host.open({ connectionId: value.connection, installationId: selected.installation.id, repository: value.repository, workspace: value.workspace }, controller.signal, () => {});
      if (attempt !== epoch.current) { opened.dispose(); return; }
      active.current!.session = opened;
      const values: BeadsResult[] = [];
      for (const operation of ['list', 'ready', 'blocked'] as const) values.push(await opened.query(operation));
      const state = await opened.state();
      if (!state.putRejected || !state.commitRejected || !state.sealed) throw new Error(copy.readOnlyError);
      if (attempt === epoch.current) { setResults(values); setStatus(''); }
    } catch (reason) {
      if (attempt === epoch.current) { setError(reason instanceof Error ? reason.message : copy.loadError); setStatus(''); controller.abort(); active.current?.session?.dispose(); active.current = undefined; }
    } finally { if (attempt === epoch.current) setBusy(false); }
  }
  useEffect(() => {
    let stopped = false, navigate = () => {};
    const locationChanged = () => navigate();
    const unsubscribe = navigation.subscribe(locationChanged);
    void (async () => {
      // Storage failure must not prevent browsing or a supplied deep link.
      let saved: WorkspaceChoice | undefined;
      const [values] = await Promise.all([host.connections(), host.storage().then(opened => { if (!stopped) { storage.current = opened; saved = readWorkspace(opened.getItem(lastWorkspaceKey)); setPreferencesError(''); } }).catch(reason => { if (!stopped) setPreferencesError(settingsError('Workspace', reason)); })]);
      if (stopped) return;
      setConnections(values);
      navigate = () => {
        if (stopped) return;
        const params = navigation.read();
        const next = workspaceChoice(params, readWorkspace(storage.current?.getItem(lastWorkspaceKey) ?? null) ?? saved, values.length === 1 ? values[0].id : '');
        if (activeScope.current === JSON.stringify(next)) return;
        setChoice(next); setBusy(false); setStatus('');
        if (validWorkspace(next) && values.some(value => value.id === next.connection && value.installation)) void load(next, values);
        else { reset(); setEditing(true); }
      };
      navigate();
    })().catch(reason => { if (!stopped) { setError(reason instanceof Error ? reason.message : copy.connectionError); setStatus(''); setBusy(false); setEditing(true); } });
    return () => { stopped = true; unsubscribe(); epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); active.current = undefined; activeScope.current = ''; };
  }, [host, navigation]);
  const selected = connections.find(value => value.id === choice.connection);
  const canDiscover = Boolean(selected?.installation && /^[\w.-]+\/[\w.-]+$/.test(choice.repository) && !choice.repository.split('/').some(part => part === '.' || part === '..'));
  async function discover() {
    if (!canDiscover || !selected?.installation) return;
    const attempt = epoch.current; setBusy(true); setError(''); setStatus(copy.discovering);
    try { const values = await host.discover(choice, selected.installation.id); if (attempt === epoch.current) setWorkspaces(values); }
    catch (reason) { if (attempt === epoch.current) setError(reason instanceof Error ? reason.message : copy.discoverError); }
    finally { if (attempt === epoch.current) { setBusy(false); setStatus(''); } }
  }
  const board = useBeadsBoardFeature({ results, loading: busy, workspace: loadedChoice?.workspace ?? '', preferencesScope: loadedChoice ? JSON.stringify(loadedChoice) : undefined });
  return { board, model: { connections, choice, loadedChoice, workspaces, busy, status, error, preferencesError, editing, results, canDiscover }, actions: {
    dismissPreferencesError: () => setPreferencesError(''),
    choice(patch: Partial<WorkspaceChoice>) { setChoice(current => ({ ...current, ...patch })); if ('connection' in patch || 'repository' in patch) setWorkspaces([]); },
    edit: () => setEditing(value => !value), discover: () => void discover(), load() {
      if (validWorkspace(choice) && selected?.installation) {
        navigation.write(choice);
      }
      void load(choice);
    },
    refresh: () => { if (loadedChoice) void load(loadedChoice); }, cancel() { reset(); setStatus(''); setEditing(true); },
  } };
}

import { useEffect, useRef, useState } from 'react';
import { bridgeRequest } from '../../../../hosted/client';
import { openBeadsSample, type BeadsResult, type BeadsSession } from '../../../../hosted/beads-sample';
import type { HostedConnection } from '../../../../src/hosted-protocol';
import { WorkspaceReader } from '../../../../hosted/workspaces';
import { applicationStorage } from '../../app-storage';
import { lastWorkspaceKey, readWorkspace, validWorkspace, workspaceChoice, type WorkspaceChoice } from './preferences';
import { BeadsSampleView } from './BeadsSample.view';
import { settingsError } from './settings-error';

const services = {
  connections: () => bridgeRequest<HostedConnection[]>({ operation: 'connections' }),
  async discover(choice: WorkspaceChoice, installationId: number) {
    const reader = new WorkspaceReader(bridgeRequest, choice.connection, choice.repository, installationId);
    return (await reader.discover()).filter(value => value.dolt && value.documents).map(value => value.name);
  },
  open: openBeadsSample, storage: applicationStorage,
};
export function BeadsSample({ host = services }: { host?: typeof services }) {
  const [connections, setConnections] = useState<HostedConnection[]>([]);
  const [choice, setChoice] = useState<WorkspaceChoice>({ connection: '', repository: '', workspace: '' });
  const [loadedChoice, setLoadedChoice] = useState<WorkspaceChoice>();
  const [workspaces, setWorkspaces] = useState<string[]>([]), [status, setStatus] = useState('Connecting…');
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [editing, setEditing] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [results, setResults] = useState<BeadsResult[]>([]);
  const active = useRef<{ controller: AbortController; session?: BeadsSession } | undefined>(undefined), epoch = useRef(0);
  const storage = useRef<Awaited<ReturnType<typeof applicationStorage>> | undefined>(undefined);
  function reset() {
    epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); active.current = undefined;
    setResults([]); setLoadedChoice(undefined); setBusy(false); setError('');
  }
  async function load(value: WorkspaceChoice, available = connections) {
    const selected = available.find(connection => connection.id === value.connection);
    if (!validWorkspace(value) || !selected?.installation) { setEditing(true); setError('Choose an approved connection and workspace.'); return; }
    reset(); const attempt = epoch.current, controller = new AbortController(); active.current = { controller };
    setBusy(true); setEditing(false); setLoadedChoice(value); setStatus('Loading tasks…');
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
      if (!state.putRejected || !state.commitRejected || !state.sealed) throw new Error('The task reader could not open a read-only snapshot.');
      if (attempt === epoch.current) { setResults(values); setStatus(''); }
    } catch (reason) {
      if (attempt === epoch.current) { setError(reason instanceof Error ? reason.message : 'Tasks could not be loaded.'); setStatus(''); controller.abort(); active.current?.session?.dispose(); active.current = undefined; }
    } finally { if (attempt === epoch.current) setBusy(false); }
  }
  useEffect(() => {
    let stopped = false, navigate = () => {};
    const locationChanged = () => navigate();
    window.addEventListener('hashchange', locationChanged);
    void (async () => {
      // Storage failure must not prevent browsing or a supplied deep link.
      let saved: WorkspaceChoice | undefined;
      const [values] = await Promise.all([host.connections(), host.storage().then(opened => { if (!stopped) { storage.current = opened; saved = readWorkspace(opened.getItem(lastWorkspaceKey)); setPreferencesError(''); } }).catch(reason => { if (!stopped) setPreferencesError(settingsError('Workspace', reason)); })]);
      if (stopped) return;
      setConnections(values);
      navigate = () => {
        if (stopped) return;
        const params = new URLSearchParams(location.hash.split('?')[1] ?? location.search);
        const next = workspaceChoice(params, readWorkspace(storage.current?.getItem(lastWorkspaceKey) ?? null) ?? saved, values.length === 1 ? values[0].id : '');
        setChoice(next); setBusy(false); setStatus('');
        if (validWorkspace(next) && values.some(value => value.id === next.connection && value.installation)) void load(next, values);
        else { reset(); setEditing(true); }
      };
      navigate();
    })().catch(reason => { if (!stopped) { setError(reason instanceof Error ? reason.message : 'Connection failed.'); setStatus(''); setBusy(false); setEditing(true); } });
    return () => { stopped = true; window.removeEventListener('hashchange', locationChanged); epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); active.current = undefined; };
  }, [host]);
  const selected = connections.find(value => value.id === choice.connection);
  const canDiscover = Boolean(selected?.installation && /^[\w.-]+\/[\w.-]+$/.test(choice.repository) && !choice.repository.split('/').some(part => part === '.' || part === '..'));
  async function discover() {
    if (!canDiscover || !selected?.installation) return;
    const attempt = epoch.current; setBusy(true); setError(''); setStatus('Finding workspaces…');
    try { const values = await host.discover(choice, selected.installation.id); if (attempt === epoch.current) setWorkspaces(values); }
    catch (reason) { if (attempt === epoch.current) setError(reason instanceof Error ? reason.message : 'Workspaces could not be loaded.'); }
    finally { if (attempt === epoch.current) { setBusy(false); setStatus(''); } }
  }
  return <BeadsSampleView model={{ connections, choice, loadedChoice, workspaces, busy, status, error, preferencesError, editing, results, canDiscover }} actions={{
    dismissPreferencesError: () => setPreferencesError(''),
    choice(patch) { setChoice(current => ({ ...current, ...patch })); if ('connection' in patch || 'repository' in patch) setWorkspaces([]); },
    edit: () => setEditing(value => !value), discover: () => void discover(), load() {
      if (validWorkspace(choice) && selected?.installation) {
        const url = new URL(location.href); url.hash = '/beads?' + new URLSearchParams(choice);
        history.replaceState(history.state, '', url);
      }
      void load(choice);
    },
    refresh: () => { if (loadedChoice) void load(loadedChoice); }, cancel() { reset(); setStatus(''); setEditing(true); },
  }} />;
}

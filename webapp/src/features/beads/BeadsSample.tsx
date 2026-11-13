import { useEffect, useRef, useState } from 'react';
import { bridgeRequest } from '../../../../hosted/client';
import { openBeadsSample, type BeadsOperation, type BeadsResult, type BeadsSession } from '../../../../hosted/beads-sample';
import type { HostedConnection } from '../../../../src/hosted-protocol';
import { WorkspaceReader } from '../../../../hosted/workspaces';
import { BeadsSampleView } from './BeadsSample.view';

export function BeadsSample() {
  const [connections, setConnections] = useState<HostedConnection[]>([]);
  const [connection, setConnection] = useState(''), [repository, setRepository] = useState(''), [workspace, setWorkspace] = useState('');
  const [workspaces, setWorkspaces] = useState<string[]>([]), [status, setStatus] = useState('Connecting to the workspace host…');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [session, setSession] = useState<BeadsSession>();
  const [results, setResults] = useState<BeadsResult[]>([]), [readOnly, setReadOnly] = useState(false);
  const active = useRef<{ controller: AbortController; session?: BeadsSession } | undefined>(undefined);
  const epoch = useRef(0);
  function reset() {
    epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); active.current = undefined;
    setSession(undefined); setResults([]); setReadOnly(false); setBusy(false); setError('');
  }
  useEffect(() => {
    let current = true;
    const params = new URLSearchParams(location.hash.split('?')[1] ?? location.search);
    setRepository(params.get('repository') ?? ''); setWorkspace(params.get('workspace') ?? '');
    void bridgeRequest<HostedConnection[]>({ operation: 'connections' }).then(values => {
      if (!current) return;
      setConnections(values); setConnection(params.get('connection') ?? (values.length === 1 ? values[0].id : ''));
      setStatus('Choose a workspace, then load and query its native Dolt snapshot.');
    }).catch(reason => { if (current) { setError(reason instanceof Error ? reason.message : 'Host connection failed.'); setStatus('Connect through the extension or Alohak settings, then reload.'); } });
    return () => { current = false; epoch.current++; active.current?.controller.abort(); active.current?.session?.dispose(); };
  }, []);
  const selected = connections.find(value => value.id === connection);
  const valid = Boolean(selected?.installation && /^[\w.-]+\/[\w.-]+$/.test(repository) && !repository.split('/').some(part => part === '.' || part === '..'));
  async function discover() {
    if (!valid || !selected?.installation) return;
    reset(); const attempt = epoch.current; setBusy(true); setStatus('Discovering published native workspaces…');
    try {
      const reader = new WorkspaceReader(bridgeRequest, connection, repository, selected.installation.id);
      const values = (await reader.discover()).filter(value => value.dolt && value.documents).map(value => value.name);
      if (attempt !== epoch.current) return;
      setWorkspaces(values); setStatus(`Found ${values.length} workspace(s) with native Beads and a workspace manifest.`);
    } catch (reason) { if (attempt === epoch.current) setError(reason instanceof Error ? reason.message : 'Discovery failed.'); }
    finally { if (attempt === epoch.current) setBusy(false); }
  }
  async function run(current: BeadsSession, operations: BeadsOperation[]) {
    const values: BeadsResult[] = [];
    for (const operation of operations) values.push(await current.query(operation));
    const state = await current.state();
    if (!state.putRejected || !state.commitRejected || !state.sealed) throw new Error('The engine did not confirm its read-only boundary.');
    return values;
  }
  async function load() {
    if (!valid || !selected?.installation || !/^[a-zA-Z0-9_-]{1,200}$/.test(workspace)) return;
    reset(); const attempt = epoch.current, controller = new AbortController(); active.current = { controller };
    setBusy(true);
    try {
      const opened = await openBeadsSample({ connectionId: connection, installationId: selected.installation.id, repository, workspace }, controller.signal, value => { if (attempt === epoch.current) setStatus(value); });
      if (attempt !== epoch.current) { opened.dispose(); return; }
      active.current!.session = opened; setSession(opened); setStatus('Running upstream Beads list, ready and blocked queries…');
      const values = await run(opened, ['list', 'ready', 'blocked']);
      if (attempt === epoch.current) { setResults(values); setReadOnly(true); setStatus('All three native Beads reads succeeded. Store writes and commits are rejected.'); }
    } catch (reason) {
      if (attempt === epoch.current) { setError(reason instanceof Error ? reason.message : 'Native Beads query failed.'); setStatus('The sample did not complete. Resolve the error, then load a fresh snapshot.'); active.current?.controller.abort(); setSession(undefined); }
    } finally { if (attempt === epoch.current) setBusy(false); }
  }
  async function query(operation: BeadsOperation) {
    if (!session || busy) return;
    const attempt = epoch.current; setBusy(true); setError('');
    try { const [result] = await run(session, [operation]); if (attempt === epoch.current) { setResults(values => [...values.filter(value => value.operation !== operation), result]); setStatus(`${operation} query succeeded against the same pinned Dolt commit.`); } }
    catch (reason) { if (attempt === epoch.current) setError(reason instanceof Error ? reason.message : 'Query failed.'); }
    finally { if (attempt === epoch.current) setBusy(false); }
  }
  return <BeadsSampleView model={{ connections, connection, repository, workspace, workspaces, valid, busy, status, error, session, results, readOnly }} actions={{
    connection(value) { reset(); setWorkspaces([]); setConnection(value); }, repository(value) { reset(); setWorkspaces([]); setRepository(value); }, workspace(value) { reset(); setWorkspace(value); },
    discover: () => void discover(), load: () => void load(), query: operation => void query(operation), cancel() { reset(); setStatus('Cancelled. The isolated Worker was disposed.'); },
  }} />;
}

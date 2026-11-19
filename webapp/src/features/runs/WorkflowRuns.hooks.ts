import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { createHostedAppHooks } from '../../app-hooks/host';
import type { AppHooksV1, ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import { useReviewStoragePicker } from '../reviews/useReviewStoragePicker';
import { WorkspaceRuns, type RunInventory, type WorkspaceRun, type RunReview, type PrivateRunOutput } from '../../../../hosted/workflow-runs';
import type { PublicS3Connection } from '../../../../src/s3-protocol';
import type { TelemetryDataset } from '../../../../src/otel-tables';
import type { QueryResult, TelemetryQueryEngine } from './query-engine';
import type { WorkflowRunsProps } from './WorkflowRuns.view';
import { jobTiming } from '../../../../src/actions-protocol';

export interface RunsLocation { connection?: string; repository?: string; workspace?: string; run?: string }
export function parseRunsSearch(search: Record<string, unknown>): RunsLocation { return Object.fromEntries(['connection', 'repository', 'workspace', 'run'].filter(key => typeof search[key] === 'string').map(key => [key, search[key]])); }
export function useRunsLocation() { return parseRunsSearch(useRouterState({ select: state => state.location.search })); }
export interface WorkflowRunsOptions { location?: RunsLocation; appHooks?: AppHooksV1; service?: WorkspaceRuns }
export function useWorkflowRunsFeature({ location = {}, appHooks, service: injected }: WorkflowRunsOptions): WorkflowRunsProps {
  const hooks = useMemo(() => appHooks ?? createHostedAppHooks(), [appHooks]);
  const service = useMemo(() => injected ?? new WorkspaceRuns(), [injected]);
  const [connections, setConnections] = useState<readonly ConnectionDTO[]>([]), [connectionId, setConnectionId] = useState(location.connection ?? '');
  const storage = useReviewStoragePicker(hooks.modules.documents, connections, connectionId, location);
  const [actionsId, setActionsId] = useState(''), [scope, setScope] = useState<WorkspaceScope>();
  const [inventory, setInventory] = useState<RunInventory>(), [selected, setSelected] = useState<WorkspaceRun>();
  const [detail, setDetail] = useState<Awaited<ReturnType<WorkspaceRuns['detail']>>>(), [reviews, setReviews] = useState<RunReview[]>([]);
  const [s3, setS3] = useState<PublicS3Connection[]>([]), [s3Id, setS3Id] = useState(''), [job, setJob] = useState('');
  const [dataset, setDataset] = useState<TelemetryDataset>(), [query, setQuery] = useState('SELECT job_instance, name, duration_ms, status_code FROM spans ORDER BY duration_ms DESC LIMIT 50');
  const [result, setResult] = useState<QueryResult>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [queryBusy, setQueryBusy] = useState(false);
  const [filter, setFilter] = useState(''), [page, setPage] = useState(0), [statusFilter, setStatusFilter] = useState('');
  const [timings, setTimings] = useState<Record<string, string>>({});
  const [outputs, setOutputs] = useState<PrivateRunOutput[]>();
  const generation = useRef(0), engine = useRef<TelemetryQueryEngine | undefined>(undefined);
  function clearQuery() { engine.current?.dispose(); engine.current = undefined; setDataset(undefined); setResult(undefined); setQueryBusy(false); }
  function reset() { generation.current++; clearQuery(); setScope(undefined); setInventory(undefined); setSelected(undefined); setDetail(undefined); setReviews([]); setError(''); setBusy(false); setTimings({}); }
  useEffect(() => {
    let stopped = false;
    void hooks.modules.documents.connect().then(found => {
      if (stopped) return; setConnections(found);
      const initial = location.connection ? found.find(item => item.id === location.connection) : found.length === 1 ? found[0] : undefined;
      if (initial) { setConnectionId(initial.id); setActionsId(initial.id); }
    }).catch(cause => { if (!stopped) setError(String(cause)); });
    void service.connections().then(found => { if (!stopped) { setS3(found); if (found.length === 1) setS3Id(found[0].id); } }).catch(() => {});
    return () => { stopped = true; generation.current++; engine.current?.dispose(); hooks.modules.documents.dispose(); };
  }, [hooks, service]);
  const connection = connections.find(item => item.id === connectionId), actionsConnection = connections.find(item => item.id === (actionsId || connectionId));
  const actions = actionsConnection && { id: actionsConnection.id, installationId: actionsConnection.installationId };
  async function openRun(run: WorkspaceRun, next = scope, token = ++generation.current) {
    if (!next || !actions) return;
    clearQuery(); setOutputs(undefined); setSelected(run); setDetail(undefined); setReviews([]); setJob(run.pointers[0]?.github_job_instance ?? ''); setBusy(true); setError('');
    try {
      const [details, related] = await Promise.allSettled([service.detail(next, run, actions), service.reviews(next, run)]);
      if (generation.current !== token) return;
      if (details.status === 'fulfilled') setDetail(details.value);
      if (related.status === 'fulfilled') setReviews(related.value);
      setError([details, related].filter(value => value.status === 'rejected').map(value => String((value as PromiseRejectedResult).reason)).join('; '));
    } finally { if (generation.current === token) setBusy(false); }
  }
  async function load() {
    if (!connection || !actions) return;
    const next = { connectionId, installationId: connection.installationId, repository: storage.repository, workspace: storage.workspace };
    reset(); const token = generation.current; setBusy(true);
    try {
      const found = await service.list(next, actions);
      if (generation.current !== token) return;
      setScope(next); setInventory(found); setPage(0);
      const linked = location.run && found.runs.find(run => run.key === location.run);
      if (linked) await openRun(linked, next, token);
      else if (location.run) setError('The linked attempt has no association in this workspace snapshot.');
    } catch (cause) { if (generation.current === token) setError(String(cause)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  async function loadTelemetry() {
    const pointer = selected?.pointers.find(item => item.github_job_instance === job), connection = s3.find(item => item.id === s3Id);
    if (!pointer || !connection) return;
    const token = ++generation.current; clearQuery(); setQueryBusy(true); setError('');
    let active: TelemetryQueryEngine | undefined;
    const timer = setTimeout(() => { if (generation.current === token) { generation.current++; clearQuery(); setError('Telemetry load timed out after 60 seconds. Retry with a smaller export.'); } }, 60000);
    try {
      const [{ decodeTelemetryArchive }, { TelemetryQueryEngine }] = await Promise.all([import('../../../../src/otel-tables'), import('./query-engine')]);
      const archive = await service.readArchive(pointer, connection);
      const decoded = await decodeTelemetryArchive(archive.bytes, archive.members, pointer.github_job_instance);
      if (generation.current !== token) return;
      active = new TelemetryQueryEngine(); engine.current = active; await active.load(decoded);
      if (generation.current !== token) { active.dispose(); return; }
      setDataset(decoded);
    } catch (cause) { active?.dispose(); if (generation.current === token) { engine.current = undefined; setError(String(cause)); } }
    finally { clearTimeout(timer); if (generation.current === token) setQueryBusy(false); }
  }
  async function runQuery() {
    if (!engine.current) return;
    const active = engine.current, token = generation.current; setQueryBusy(true); setError(''); setResult(undefined);
    const timer = setTimeout(() => { if (generation.current === token) { generation.current++; clearQuery(); setError('Query timed out after 10 seconds. Reload the export.'); } }, 10000);
    try { const value = await active.query(query); if (generation.current === token) setResult(value); }
    catch (cause) { if (generation.current === token) setError(String(cause)); }
    finally { clearTimeout(timer); if (generation.current === token) setQueryBusy(false); }
  }
  async function loadOutputs() {
    const pointer = selected?.pointers[0], connection = s3.find(item => item.id === s3Id);
    if (!pointer || !connection) return;
    const token = generation.current; setQueryBusy(true); setError('');
    try { const found = await service.outputs(pointer, connection); if (generation.current === token) setOutputs(found); }
    catch (cause) { if (generation.current === token) setError(String(cause)); }
    finally { if (generation.current === token) setQueryBusy(false); }
  }
  const filtered = inventory?.runs.filter(run => (!statusFilter || (run.metadata?.conclusion ?? run.metadata?.status) === statusFilter) && `${run.metadata?.display_title ?? ''} ${run.repository} ${run.run} ${run.metadata?.head_branch ?? ''}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const rows = filtered.slice(page * 20, page * 20 + 20), visibleKeys = rows.map(row => row.key).join('|');
  useEffect(() => {
    if (!scope || !actions || selected) return;
    let stopped = false, index = 0;
    const pending = rows.filter(row => !timings[row.key]);
    void Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (!stopped && index < pending.length) {
        const run = pending[index++];
        try {
          const detail = await service.detail(scope, run, actions), timing = detail.jobs && jobTiming(detail.jobs);
          const text = timing?.milliseconds != null ? `${(timing.milliseconds / 1000).toFixed(1)} s · ${timing.label.toLowerCase()}` : 'Timing unavailable';
          if (!stopped) setTimings(previous => ({ ...previous, [run.key]: text }));
        } catch { if (!stopped) setTimings(previous => ({ ...previous, [run.key]: 'Timing unavailable' })); }
      }
    }));
    return () => { stopped = true; };
  }, [scope, visibleKeys, selected, actionsId, service]);
  return { connections, connectionId, actionsId: actionsId || connectionId, storage, scope, inventory, selected, detail, reviews, s3, s3Id, job, dataset, query, result, error, busy, queryBusy, filter, statusFilter, page, timings, outputs, rows, total: filtered.length,
    actions: { setConnection(value) { reset(); storage.clearConnection(); setConnectionId(value); }, setRepository(value) { reset(); storage.chooseRepository(value); }, setWorkspace(value) { reset(); storage.chooseWorkspace(value); }, setActions(value) { reset(); setActionsId(value); }, load, open: openRun,
      back() { generation.current++; clearQuery(); setSelected(undefined); setDetail(undefined); setReviews([]); setBusy(false); }, setS3(value) { generation.current++; clearQuery(); setOutputs(undefined); setS3Id(value); }, setJob(value) { generation.current++; clearQuery(); setJob(value); }, setQuery, runQuery, loadTelemetry, loadOutputs, cancel() { generation.current++; clearQuery(); }, setFilter(value) { setPage(0); setFilter(value); }, setStatus(value) { setPage(0); setStatusFilter(value); }, setPage } };
}

import type { ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewStoragePicker } from '../reviews/useReviewStoragePicker';
import type { RunInventory, WorkspaceRun, WorkspaceRuns, RunReview, PrivateRunOutput } from '../../../../hosted/workflow-runs';
import type { PublicS3Connection } from '../../../../src/s3-protocol';
import type { TelemetryDataset } from '../../../../src/otel-tables';
import type { QueryResult } from './query-engine';
import { jobTiming } from '../../../../src/actions-protocol';
import { runsHref } from './navigation';
import { copy } from './WorkflowRuns.copy';
export { WorkflowRunsPresentation as WorkflowRunsView } from './WorkflowRuns.presentation';

export interface WorkflowRunsProps {
  connections: readonly ConnectionDTO[]; connectionId: string; actionsId: string; storage: ReviewStoragePicker;
  scope?: WorkspaceScope; inventory?: RunInventory; selected?: WorkspaceRun; rows: WorkspaceRun[]; total: number;
  detail?: Awaited<ReturnType<WorkspaceRuns['detail']>>; reviews: RunReview[]; s3: PublicS3Connection[]; s3Id: string; job: string;
  dataset?: TelemetryDataset; query: string; result?: QueryResult; error: string; busy: boolean; queryBusy: boolean; filter: string; statusFilter: string; page: number;
  timings: Record<string, string>; outputs?: PrivateRunOutput[];
  actions: { setConnection(value: string): void; setRepository(value: string): void; setWorkspace(value: string): void; setActions(value: string): void; load(): void; open(run: WorkspaceRun): void; back(): void; setS3(value: string): void; setJob(value: string): void; setQuery(value: string): void; runQuery(): void; loadTelemetry(): void; loadOutputs(): void; cancel(): void; setFilter(value: string): void; setStatus(value: string): void; setPage(value: number): void };
}
const queryScope = (p: WorkflowRunsProps) => p.scope ? new URLSearchParams({ connection: p.scope.connectionId, repository: p.scope.repository, workspace: p.scope.workspace }).toString() : '';
export const duration = (ms: number | null) => ms === null ? 'Unavailable' : `${(ms / 1000).toFixed(1)} s`;
export function RunsHeader(p: WorkflowRunsProps) {
  return <header className="page-header"><h1>{copy.title}</h1><nav><a href={`#/documents?${queryScope(p)}`}>{copy.documents}</a><a href={`#/reviews?${queryScope(p)}`}>{copy.reviews}</a><a href="../s3.html">{copy.s3Settings}</a></nav></header>;
}
export function RunsWorkspace(p: WorkflowRunsProps) {
  const { actions, storage } = p;
  return <form className="connection-panel connection-fields" onSubmit={event => { event.preventDefault(); actions.load(); }}>
    <label>{copy.workspaceConnection}<select value={p.connectionId} onChange={event => actions.setConnection(event.target.value)}><option value="">{copy.chooseConnection}</option>{p.connections.map(item => <option key={item.id} value={item.id}>{[item.name, item.account].join(' · ')}</option>)}</select></label>
    <label>{copy.repository}<select value={storage.repository} disabled={storage.repositoriesBusy} onChange={event => actions.setRepository(event.target.value)}><option value="">{copy.chooseRepository}</option>{storage.repository && !storage.repositories.some(item => item.fullName === storage.repository) && <option value={storage.repository}>{storage.repository}</option>}{storage.repositories.map(item => <option key={item.fullName}>{item.fullName}</option>)}</select></label>
    <label>{copy.workspace}<select aria-label={copy.workspace} value={storage.workspace} disabled={storage.workspacesBusy} onChange={event => actions.setWorkspace(event.target.value)}><option value="">{copy.chooseWorkspace}</option>{storage.workspace && !storage.workspaces.includes(storage.workspace) && <option value={storage.workspace}>{storage.workspace}</option>}{storage.workspaces.map(item => <option key={item}>{item}</option>)}</select></label>
    <label>{copy.actionsConnection}<select value={p.actionsId} onChange={event => actions.setActions(event.target.value)}><option value="">{copy.chooseActions}</option>{p.connections.map(item => <option key={item.id} value={item.id}>{[item.name, item.account].join(' · ')}</option>)}</select></label>
    <button type="submit" disabled={p.busy || p.queryBusy || !p.connectionId || !storage.repository || !storage.workspace || !p.actionsId || storage.workspacesBusy}>{copy.load}</button><button type="button" onClick={storage.retry}>{copy.reload}</button>
    {(storage.repositoryError || storage.workspaceError) && <p role="alert">{storage.repositoryError || storage.workspaceError}</p>}
  </form>;
}
export function RunsStatus(p: WorkflowRunsProps) {
  return <>{p.error && <p role="alert">{p.error}</p>}{p.busy && <p role="status">{copy.loading}</p>}{p.inventory && <details><summary>{copy.provenance}</summary><code>{[p.inventory.snapshot, p.inventory.workspaceRef].filter(Boolean).join(' · ')}</code>{p.inventory.notices.map(item => <p key={item}>{item}</p>)}</details>}</>;
}
export function RunsList(p: WorkflowRunsProps) {
  if (!p.inventory) return null;
  const { actions } = p;
  return <section aria-label={copy.runList}><div className="connection-fields"><label>{copy.find}<input value={p.filter} onChange={event => actions.setFilter(event.target.value)} /></label><label>{copy.status}<select value={p.statusFilter} onChange={event => actions.setStatus(event.target.value)}><option value="">{copy.allStatuses}</option>{['success', 'failure', 'cancelled', 'in_progress', 'queued'].map(item => <option key={item}>{item}</option>)}</select></label></div>
    <ol className="run-list">{p.rows.map(run => <li key={run.key}><h2><button onClick={() => actions.open(run)}>{run.metadata?.display_title ?? [run.repository, run.run].join(' #')}</button></h2><p>{[run.metadata?.name, run.repository, run.run, run.attempt].join(' · ')}</p><p>{[run.metadata?.status, run.metadata?.conclusion, run.metadata?.created_at].filter(Boolean).join(' · ')}</p><p>{p.timings[run.key] ?? copy.timingLoading}</p><p>{run.metadata?.head_branch} <code>{run.metadata?.head_sha}</code></p>{run.error && <p role="alert">{run.error}</p>}<a href={runsHref(p.scope!, run)}>{copy.permalink}</a></li>)}</ol>
    {!p.total && <p>{copy.empty}</p>}<div className="run-pagination"><button disabled={p.page === 0} onClick={() => actions.setPage(p.page - 1)}>{copy.previous}</button><output>{p.page + 1}</output><button disabled={(p.page + 1) * 20 >= p.total} onClick={() => actions.setPage(p.page + 1)}>{copy.next}</button></div>
  </section>;
}
export function RunsAttempt(p: WorkflowRunsProps) {
  const { selected, detail } = p;
  if (!selected) return null;
  const timing = detail?.jobs && jobTiming(detail.jobs);
  const timingText = timing ? [`${timing.label}: ${duration(timing.milliseconds)}`, `${copy.summedTime}: ${duration(timing.summed)}`].join(' · ') : copy.noTiming;
  return <article aria-label={copy.attempt}><button onClick={p.actions.back}>{copy.back}</button><h2>{[selected.metadata?.display_title ?? selected.run, selected.attempt].join(' · ')}</h2><a href={`https://github.com/${selected.repository}/actions/runs/${selected.run}/attempts/${selected.attempt}`} target="_blank" rel="noreferrer">{copy.openGitHub}</a><p>{[selected.metadata?.status, selected.metadata?.conclusion, selected.repository].join(' · ')}</p><p>{timingText}</p>
    {detail?.errors.map(item => <p role="alert" key={item}>{item}</p>)}
    <section><h3>{copy.jobs}</h3><ul>{detail?.jobs?.map(job => <li key={job.id}>{[job.name, job.status, job.conclusion, job.started_at, job.completed_at].filter(Boolean).join(' · ')}</li>)}</ul></section>
    <RunsTelemetry {...p} /><RunsOutputs {...p} />
    <section><h3>{copy.relatedReviews}</h3><ul>{p.reviews.map((review, index) => <li key={index}><a href={`#/reviews/${review.pin.resource.split('/')[1]}?${queryScope(p)}&version=${review.pin.version}&snapshot=${review.pin.snapshot}`}>{review.title}</a><span>{review.label}</span></li>)}</ul>{!p.reviews.length && <p>{copy.noReviews}</p>}</section>
  </article>;
}
export function RunsOutputs(p: WorkflowRunsProps) {
  return <section><h3>{copy.outputs}</h3><details><summary>{copy.outputHelp}</summary><p>{copy.outputPermission}</p><ul>{p.selected?.pointers.map(item => <li key={item.github_job_instance}><code>{[item.github_job_instance, item.bytes, item.sha256, item.bucket, item.prefix, item.payload_key].join(' · ')}</code></li>)}</ul></details>
    <button disabled={!p.s3Id || p.busy || p.queryBusy} onClick={p.actions.loadOutputs}>{copy.loadOutputs}</button>
    {p.outputs && (p.outputs.length ? <ul>{p.outputs.map(output => <li key={output.receiptKey}><code>{[output.name, output.bytes, output.members, output.sha256, output.receiptKey].join(' · ')}</code></li>)}</ul> : <p>{copy.noOutputs}</p>)}
    <h4>{copy.artifacts}</h4>{p.detail?.artifacts ? <ul>{p.detail.artifacts.map(item => <li key={item.id}>{[item.name, item.size_in_bytes, item.expired ? copy.expired : copy.available, item.expires_at].join(' · ')}</li>)}</ul> : <p>{copy.unavailableArtifacts}</p>}{p.detail?.artifacts?.length === 0 && <p>{copy.noArtifacts}</p>}
  </section>;
}
export function RunsTelemetry(p: WorkflowRunsProps) {
  const { actions, dataset } = p, pointer = p.selected?.pointers.find(item => item.github_job_instance === p.job);
  return <section aria-label={copy.telemetryLabel}><h3>{copy.telemetry}</h3><details><summary>{copy.provenance}</summary><p>{copy.telemetryLimits}</p></details><div className="connection-fields"><label>{copy.s3}<select value={p.s3Id} onChange={event => actions.setS3(event.target.value)}><option value="">{copy.chooseS3}</option>{p.s3.map(item => <option key={item.id} value={item.id}>{[item.name, item.bucket, item.prefix].join(' · ')}</option>)}</select></label><label>{copy.job}<select value={p.job} onChange={event => actions.setJob(event.target.value)}>{p.selected?.pointers.map(item => <option key={item.github_job_instance}>{item.github_job_instance}</option>)}</select></label><button onClick={actions.loadTelemetry} disabled={p.busy || p.queryBusy || !p.s3Id || !pointer}>{copy.loadTelemetry}</button><button disabled={!p.queryBusy && !dataset} onClick={actions.cancel}>{copy.cancel}</button></div>
    {!p.s3.length && <p>{copy.noS3}</p>}{p.queryBusy && <p role="status">{copy.queryLoading}</p>}
    {dataset && <><p>{dataset.signals.join(', ')}</p>{dataset.warnings.map(item => <p key={item}>{item}</p>)}<details><summary>{copy.tables}</summary><ul>{Object.entries(dataset.tables).map(([name, rows]) => <li key={name}><button disabled={!rows.length} onClick={() => actions.setQuery(`SELECT * FROM ${name} LIMIT 20`)}>{name}</button><span>{rows.length}</span><code>{rows.length ? Object.keys(rows[0]).join(', ') : null}</code></li>)}</ul></details><div className="run-query"><label htmlFor="workflow-run-sql">{copy.sql}</label><textarea id="workflow-run-sql" rows={6} spellCheck={false} value={p.query} onChange={event => actions.setQuery(event.target.value)} /></div><button disabled={p.queryBusy} onClick={actions.runQuery}>{copy.runQuery}</button></>}
    {p.result && <div className="run-results"><output>{p.result.rows.length}</output>{p.result.truncated && <p>{copy.truncated}</p>}<table><thead><tr>{p.result.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{p.result.rows.map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col}>{cell}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}

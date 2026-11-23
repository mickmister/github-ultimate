import type { ReviewRequest, ReviewPin } from '../../../../src/review-protocol';
import type { ProcessEvidence } from '../../../../hosted/review-process';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

export function evidenceHref(repository: string, pin: ReviewPin) {
  return `https://github.com/${repository}/blob/${pin.snapshot}/documents/${pin.resource.split('/').map(encodeURIComponent).join('/')}`;
}
export function ReviewProcessView({ scope, process, loading, evidence, error, checked }: { scope: WorkspaceScope; process: NonNullable<ReviewRequest['process']>; loading: boolean; evidence: ProcessEvidence[]; error?: string; checked?: string }) {
  return <section className="review-summary" data-ui="review-process" aria-label="QRSPI process evidence"><h2>QRSPI · {process.id}</h2>
    <p>Workspace: {process.workspace_ref} · Thread: {process.thread_id}</p>
    <p>Review checkpoint: waiting for review where no response is saved. Saved responses and workflow delivery are shown separately below; neither proves phase completion.</p>
    {loading && <LoadingIndicator compact label="Loading pinned and current methodology evidence…" />}
    {error && <p role="alert">Process evidence unavailable: {error}. Position unknown, not failed.</p>}
    {checked && <p>Evidence checked: {checked}. This is a snapshot, not live workflow status.</p>}
    <ul>{evidence.map(item => <li key={item.pin.resource}><strong>{item.label}</strong>{item.error && <p role="alert">{item.error}. Historical evidence is not replaced by current metadata.</p>}<p>Pinned: {item.metadata}</p>
      <a href={evidenceHref(scope.repository, item.pin)}>Exact pinned artifact</a><p><code>{item.pin.version}</code> · snapshot <code>{item.pin.snapshot}</code></p>
      {item.current === undefined ? <p>Current metadata unknown: host does not expose current evidence.</p> : item.current === null ? <p>Current artifact missing. Historical pinned approval, if any, remains evidence only.</p> : <><p>{item.current.pin.version === item.pin.version ? 'Current matches pinned artifact.' : 'Stale review pin: current artifact differs.'} Current: {item.current.metadata}</p><a href={evidenceHref(scope.repository, item.current.pin)}>Exact current artifact at check</a><p><code>{item.current.pin.version}</code> · snapshot <code>{item.current.pin.snapshot}</code></p></>}
    </li>)}</ul>
  </section>;
}

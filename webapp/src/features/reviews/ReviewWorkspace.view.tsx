import type { Dispatch, SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { ReviewPacket } from './ReviewPacket';
import { reviewHref } from './ReviewWorkspace';
import { reviewStatus } from './model';
import './reviews.css';
import { ReviewDiagnostics } from './ReviewDiagnostics';

interface Props {
  connections: readonly ConnectionDTO[]; connectionId: string; repository: string; workspace: string;
  scope: WorkspaceScope | null; listing: ReviewListing | null; opened: OpenReview | null; service?: ReviewsModuleV1;
  busy: boolean; error: string;
  workspaces: readonly string[];
  waitingOnly: boolean; setWaitingOnly(value: boolean): void;
  actions: { setConnectionId(value: string): void; setRepository(value: string): void; setWorkspace(value: string): void; load(): void; refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>> };
}
export function ReviewWorkspaceView({ connections, connectionId, repository, workspace, workspaces, waitingOnly, setWaitingOnly, scope, listing, opened, busy, error, service, actions }: Props) {
  const requests = listing?.requests.filter(review => !waitingOnly || review.request.status === 'published' && reviewStatus(review, listing.artifacts, listing.reviewer) !== 'Responded') ?? [];
  return <main className="app-shell review-workspace" data-ui="review-workspace"><header className="page-header"><div><p className="eyebrow">GitHub Ultimate</p><h1>{opened ? opened.request.title : 'Review requests'}</h1></div>
    <nav><a href={scope ? reviewHref(scope) : '#/reviews'}>Review inbox</a><a href={`#/documents${scope ? '?' + new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace }) : ''}`}>Workspace documents</a></nav></header>
    <ReviewDiagnostics />
    {!opened && <form className="connection-panel connection-fields" onSubmit={event => { event.preventDefault(); actions.load(); }}>
      <label>Approved connection<select value={connectionId} onChange={event => actions.setConnectionId(event.target.value)}><option value="">Choose a connection</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.account}</option>)}</select></label>
      <label>Storage repository<input value={repository} placeholder="owner/storage" onChange={event => actions.setRepository(event.target.value)} /></label>
      <label>Workspace<input value={workspace} list="review-workspaces" placeholder="Find workspaces or enter the workspace handle" onChange={event => actions.setWorkspace(event.target.value)} /></label>
      <datalist id="review-workspaces">{workspaces.map(name => <option key={name} value={name} />)}</datalist>
      <button disabled={busy || !connectionId || !repository.trim()}>{workspace.trim() ? 'Open review inbox' : 'Find workspaces'}</button>
      {!connectionId && <p>Select an approved connection to access storage. If none are listed, connect or approve this site in your credential broker, then reload.</p>}
      {connectionId && !workspace && <p>Enter the storage repository, then select Find workspaces. A single document workspace opens automatically; otherwise choose a discovered workspace.</p>}
    </form>}
    {busy && !opened && <p role="status">Loading review requests…</p>}{error && <p role="alert">{error}</p>}
    {scope && service && opened && <ReviewPacket key={`${scope.connectionId}:${scope.installationId}:${scope.repository}:${scope.workspace}:${opened.pin.version}`} scope={scope} review={opened} listing={listing} service={service} refresh={actions.refresh} updateListing={actions.updateListing} error={error} />}
    {scope && listing && !opened && <section aria-label="Review inbox"><div className="section-heading"><h2>{scope.workspace}</h2><button disabled={busy} onClick={actions.refresh}>Refresh requests</button></div>
        <label><input type="checkbox" checked={waitingOnly} onChange={event => setWaitingOnly(event.target.checked)} />Only waiting for my response</label>
        {!requests.length && <p>{waitingOnly ? 'No review requests are waiting for your response in this workspace.' : 'No review requests have been published in this workspace.'}</p>}
        <ul className="review-inbox">{requests.map(review => <li key={review.request.request_id}><h3><a href={reviewHref(scope, review)}>{review.request.title}</a></h3><p>{review.request.purpose}</p><p>{reviewStatus(review, listing.artifacts, listing.reviewer)} · {review.request.bead_id} · {review.request.members.length} items</p></li>)}</ul>
      </section>}
  </main>;
}

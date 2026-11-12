import type { Dispatch, SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { ReviewSession } from './ReviewSession';
import { reviewHref } from './ReviewWorkspace';
import { reviewStatus } from './model';
import './reviews.css';

interface Props {
  connections: readonly ConnectionDTO[]; connectionId: string; repository: string; workspace: string;
  scope: WorkspaceScope | null; listing: ReviewListing | null; opened: OpenReview | null; service?: ReviewsModuleV1;
  busy: boolean; error: string;
  actions: { setConnectionId(value: string): void; setRepository(value: string): void; setWorkspace(value: string): void; load(): void; refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>> };
}
export function ReviewWorkspaceView({ connections, connectionId, repository, workspace, scope, listing, opened, busy, error, service, actions }: Props) {
  return <main className="app-shell review-workspace"><header className="page-header"><div><p className="eyebrow">GitHub Ultimate</p><h1>{opened ? opened.request.title : 'Review requests'}</h1></div>
    <nav><a href={scope ? reviewHref(scope) : '#/reviews'}>Review inbox</a><a href={`#/documents${scope ? '?' + new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace }) : ''}`}>Workspace documents</a></nav></header>
    {!opened && <form className="connection-panel connection-fields" onSubmit={event => { event.preventDefault(); actions.load(); }}>
      <label>Approved connection<select value={connectionId} onChange={event => actions.setConnectionId(event.target.value)}><option value="">Choose a connection</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.account}</option>)}</select></label>
      <label>Storage repository<input value={repository} placeholder="owner/storage" onChange={event => actions.setRepository(event.target.value)} /></label>
      <label>Workspace<input value={workspace} onChange={event => actions.setWorkspace(event.target.value)} /></label>
      <button disabled={busy || !connectionId || !repository || !workspace}>Open review inbox</button>
    </form>}
    {busy && <p role="status">Loading review requests…</p>}{error && <p role="alert">{error}</p>}
    {scope && listing && service && (opened ? <ReviewSession key={`${scope.connectionId}:${scope.repository}:${scope.workspace}:${opened.pin.version}`} scope={scope} review={opened} listing={listing} service={service} refresh={actions.refresh} updateListing={actions.updateListing} />
      : <section aria-label="Review inbox"><div className="section-heading"><h2>{scope.workspace}</h2><button disabled={busy} onClick={actions.refresh}>Refresh requests</button></div>
        {!listing.requests.length && <p>No review requests have been published in this workspace.</p>}
        <ul className="review-inbox">{listing.requests.map(review => <li key={review.request.request_id}><h3><a href={reviewHref(scope, review)}>{review.request.title}</a></h3><p>{review.request.purpose}</p><p>{reviewStatus(review, listing.artifacts)} · {review.request.bead_id} · {review.request.members.length} items</p></li>)}</ul>
      </section>)}
  </main>;
}

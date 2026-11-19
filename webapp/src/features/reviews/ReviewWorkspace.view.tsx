import type { Dispatch, SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { ReviewPacket } from './ReviewPacket';
import { reviewHref } from './ReviewWorkspace';
import { reviewStatus } from './model';
import './reviews.css';
import { ReviewDiagnostics } from './ReviewDiagnostics';
import type { ReviewStoragePicker } from './useReviewStoragePicker';

interface Props {
  connections: readonly ConnectionDTO[]; connectionId: string; repository: string; workspace: string;
  scope: WorkspaceScope | null; listing: ReviewListing | null; opened: OpenReview | null; service?: ReviewsModuleV1;
  busy: boolean; error: string;
  storage: ReviewStoragePicker;
  waitingOnly: boolean; setWaitingOnly(value: boolean): void;
  actions: { setConnectionId(value: string): void; setRepository(value: string): void; setWorkspace(value: string): void; load(): void; refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>> };
}
export function ReviewWorkspaceView({ connections, connectionId, repository, workspace, storage, waitingOnly, setWaitingOnly, scope, listing, opened, busy, error, service, actions }: Props) {
  const requests = listing?.requests.filter(review => !waitingOnly || review.request.status === 'published' && reviewStatus(review, listing.artifacts, listing.reviewer) !== 'Responded') ?? [];
  return <main className="app-shell review-workspace" data-ui="review-workspace"><header className="page-header"><div><p className="eyebrow">GitHub Ultimate</p><h1>{opened ? opened.request.title : 'Review requests'}</h1></div>
    <nav><a href={scope ? reviewHref(scope) : '#/reviews'}>Review inbox</a><a href={`#/documents${scope ? '?' + new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace }) : ''}`}>Workspace documents</a></nav></header>
    <ReviewDiagnostics />
    {!opened && <form className="connection-panel connection-fields" onSubmit={event => { event.preventDefault(); actions.load(); }}>
      <label>Approved connection<select aria-label="Approved connection" value={connectionId} onChange={event => actions.setConnectionId(event.target.value)}><option value="">Choose a connection</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.account}</option>)}</select></label>
      {storage.canListRepositories ? <label>Storage repository<select aria-label="Storage repository" value={repository} disabled={!connectionId || storage.repositoriesBusy} onChange={event => actions.setRepository(event.target.value)}>
        <option value="">{storage.repositoriesBusy ? 'Loading repositories…' : 'Choose a storage repository'}</option>
        {repository && !storage.repositories.some(item => item.fullName === repository) && <option value={repository}>{repository} (selected)</option>}
        {storage.repositories.map(item => <option key={item.fullName} value={item.fullName}>{item.fullName}{item.private ? ' · private' : ''}</option>)}
      </select></label> : <label>Storage repository<input value={repository} placeholder="owner/storage" onChange={event => actions.setRepository(event.target.value)} /></label>}
      <label>Workspace<select aria-label="Workspace" value={workspace} disabled={!repository || storage.workspacesBusy} onChange={event => actions.setWorkspace(event.target.value)}>
        <option value="">{storage.workspacesBusy ? 'Finding workspaces…' : 'Choose a workspace'}</option>
        {workspace && !storage.workspaces.includes(workspace) && <option value={workspace}>{workspace} (selected)</option>}
        {storage.workspaces.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {(storage.repositoriesBusy || storage.workspacesBusy) && <p aria-live="polite">{storage.repositoriesBusy ? 'Loading repositories for this connection…' : 'Finding document workspaces in the selected repository…'}</p>}
      {!storage.repositoriesBusy && !storage.repositoryError && connectionId && storage.canListRepositories && !storage.repositories.length && !repository && <p>No repositories are available. Check the selected connection's installation access.</p>}
      {!storage.workspacesBusy && !storage.workspaceError && repository && !workspace && !storage.workspaces.length && <p>No document workspaces found in this repository.</p>}
      {(storage.repositoryError || storage.workspaceError) && <p role="alert">{storage.repositoryError || storage.workspaceError}</p>}
      <button type="button" disabled={!connectionId || storage.repositoriesBusy || storage.workspacesBusy} onClick={storage.retry}>Reload choices</button>
      <button disabled={busy || !connectionId || !repository || !workspace || storage.workspacesBusy}>Open review inbox</button>
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

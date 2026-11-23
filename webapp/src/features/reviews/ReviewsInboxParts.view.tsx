import type { ReviewWorkspaceModel } from './ReviewWorkspace.view';
import { reviewHref } from './navigation';
import { reviewStatus } from './model';
import { reviewsCopy as copy } from './Reviews.copy';
import { ReviewCheckbox } from './ReviewCheckbox.view';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

export function ReviewSource({ connections, connectionId, repository, workspace, storage, busy, actions }: ReviewWorkspaceModel) {
  return <form className="connection-panel review-source" onSubmit={event => { event.preventDefault(); actions.load(); }}>
    <label>{copy.connection.text}<select aria-label={copy.connection.text} value={connectionId} onChange={event => actions.setConnectionId(event.target.value)}><option value="">{copy.chooseConnection.text}</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}{copy.separator.text}{connection.account}</option>)}</select></label>
    {storage.canListRepositories ? <label>{copy.repository.text}<select aria-label={copy.repository.text} value={repository} disabled={!connectionId || storage.repositoriesBusy} onChange={event => actions.setRepository(event.target.value)}>
      <option value="">{storage.repositoriesBusy ? copy.loadingRepositories.text : copy.chooseRepository.text}</option>
      {repository && !storage.repositories.some(item => item.fullName === repository) && <option value={repository}>{repository}</option>}
      {storage.repositories.map(item => <option key={item.fullName} value={item.fullName}>{item.fullName}{item.private ? copy.private.text : ''}</option>)}
    </select></label> : <label>{copy.repository.text}<input value={repository} onChange={event => actions.setRepository(event.target.value)} /></label>}
    <label>{copy.workspace.text}<select aria-label={copy.workspace.text} value={workspace} disabled={!repository || storage.workspacesBusy} onChange={event => actions.setWorkspace(event.target.value)}>
      <option value="">{storage.workspacesBusy ? copy.loadingWorkspaces.text : copy.chooseWorkspace.text}</option>
      {workspace && !storage.workspaces.includes(workspace) && <option value={workspace}>{workspace}</option>}
      {storage.workspaces.map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>
    {(storage.repositoriesBusy || storage.workspacesBusy) && <LoadingIndicator compact label={storage.repositoriesBusy ? copy.loadingRepositories.text : copy.loadingWorkspaces.text} />}
    {!storage.repositoriesBusy && !storage.repositoryError && connectionId && storage.canListRepositories && !storage.repositories.length && !repository && <p>{copy.noRepositories.text}</p>}
    {!storage.workspacesBusy && !storage.workspaceError && repository && !workspace && !storage.workspaces.length && <p>{copy.noWorkspaces.text}</p>}
    {(storage.repositoryError || storage.workspaceError) && <p role="alert">{storage.repositoryError || storage.workspaceError}</p>}
    <button type="button" disabled={!connectionId || storage.repositoriesBusy || storage.workspacesBusy} onClick={storage.retry}>{copy.reload.text}</button>
    <button disabled={busy || !connectionId || !repository || !workspace || storage.workspacesBusy}>{copy.open.text}</button>
  </form>;
}
export function ReviewFilters({ listing, waitingOnly, setWaitingOnly }: ReviewWorkspaceModel) {
  return listing && <ReviewCheckbox label={copy.waiting.text} checked={waitingOnly} onChange={setWaitingOnly} />;
}
export function ReviewInboxList({ scope, listing, waitingOnly, busy, actions }: ReviewWorkspaceModel) {
  if (!scope || !listing) return null;
  const requests = listing.requests.filter(review => !waitingOnly || review.request.status === 'published' && reviewStatus(review, listing.artifacts, listing.reviewer) !== 'Responded');
  return <section aria-label={copy.inbox.text} className="review-request-list"><div className="section-heading"><h2>{scope.workspace}</h2><button disabled={busy} onClick={actions.refresh}>{copy.refresh.text}</button></div>
    {busy && <LoadingIndicator compact label={copy.loading.text} />}
    {!requests.length && <p>{waitingOnly ? copy.emptyWaiting.text : copy.empty.text}</p>}
    <ul className="review-inbox">{requests.map(review => <li key={review.request.request_id}><h3><a href={reviewHref(scope, review)}>{review.request.title}</a></h3><p>{review.request.purpose}</p><p>{reviewStatus(review, listing.artifacts, listing.reviewer)}{copy.separator.text}{review.request.bead_id}</p></li>)}</ul>
  </section>;
}

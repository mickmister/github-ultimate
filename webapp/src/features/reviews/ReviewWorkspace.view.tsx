import type { ReviewWorkspaceModel } from './contracts';
import { ReviewPacket } from './ReviewPacket';
import { reviewHref } from './navigation';
import { ReviewDiagnostics } from './ReviewDiagnostics';
import { ReviewsInboxPresentation } from './ReviewsInbox.presentation';
import { reviewsCopy as copy } from './Reviews.copy';
import './reviews.css';

export type { ReviewWorkspaceModel } from './contracts';
export function ReviewWorkspaceView(props: ReviewWorkspaceModel & { unifiedNavigation?: boolean }) {
  const { scope, listing, opened, busy, error, service, actions } = props;
  return <main className="app-shell review-workspace" data-ui="review-workspace">
    <header className="page-header"><h1>{opened ? opened.request.title : copy.requests.text}</h1>
      {!props.unifiedNavigation && <nav><a href={scope ? reviewHref(scope) : '#/reviews'}>{copy.inbox.text}</a></nav>}
    </header>
    <ReviewDiagnostics />
    {busy && !opened && <p role="status">{copy.loading.text}</p>}{error && <p role="alert">{error}</p>}
    {scope && service && opened
      ? <ReviewPacket key={`${scope.connectionId}:${scope.installationId}:${scope.repository}:${scope.workspace}:${opened.request.request_id}:${opened.pin.version}:${opened.pin.snapshot}`} scope={scope} review={opened} listing={listing} service={service} refresh={actions.refresh} updateListing={actions.updateListing} error={error} />
      : <ReviewsInboxPresentation {...props} />}
  </main>;
}

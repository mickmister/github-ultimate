import { ark } from '@ark-ui/react/factory';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ReviewArtifact } from '../../../../src/review-protocol';
import type { Answers } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1, StoredReviewArtifact } from '../../app-hooks/reviews';
import { ReviewProcess } from './ReviewProcess';
import { ReviewWorkflow } from './ReviewWorkflow';
import { evidenceHref } from './ReviewProcess.view';
import { ReviewMemberContent } from './ReviewMemberContent';
import { reviewHref } from './ReviewWorkspace';
import type { ReviewContents } from './review-contents';
import { submissionNotice } from './submission-notice';
import type { ReviewDocumentZen } from './contracts';
import { ReviewsDetailPresentation } from './ReviewsDetail.presentation';
import { reviewsCopy as copy } from './Reviews.copy';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

interface Props {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing; latest?: OpenReview; service: ReviewsModuleV1;
  selected: string; forms: ReviewArtifact['forms']; progress: string[]; responses: StoredReviewArtifact[]; submitted: Set<string>;
  busy: boolean; dirty: boolean; notice: string; error: string; sidebarOpen: boolean; contents: ReviewContents;
  documentZen: ReviewDocumentZen;
  actions: { select(id: string): void; toggleSidebar(): void; retryContents(): void; answer(id: string, answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; progress(id: string, checked: boolean): void; saveDraft(): void; submit(id?: string): void; retry(value: ReviewArtifact): void; refresh(): void };
}
export function ReviewSessionView({ scope, review, listing, latest, service, selected, forms, progress, responses, submitted, busy, dirty, notice, error, sidebarOpen, contents, documentZen, actions }: Props) {
  const member = review.request.members.find(member => member.id === selected)!;
  const formMembers = review.request.members.filter(item => item.kind === 'form');
  const nextForm = formMembers[formMembers.findIndex(item => item.id === selected) + 1];
  const accepting = review.request.status === 'published' && latest?.request.status !== 'withdrawn';
  const downloaded = [...contents.values()].filter(item => item.status === 'ready').length;
  const failed = [...contents.values()].filter(item => item.status === 'error').length;
  const downloading = downloaded + failed < contents.size;
  const contentProgress = downloading ? copy.downloading.text(downloaded + failed, contents.size) : failed ? copy.unavailableContents.text(failed) : '';
  return <section aria-label={copy.session.text}><header className="review-summary"><p>{review.request.purpose}</p><p><strong>{copy.requested.text}</strong> {review.request.question}</p>
    <p>{review.request.change_kind === 'implemented' ? copy.implemented.text : review.request.change_kind === 'proposal' ? copy.proposed.text : copy.mixed.text}{copy.separator.text}{review.request.bead_id}</p>
    <button onClick={actions.refresh} disabled={busy}>{copy.checkUpdates.text}</button>
    {latest && latest.pin.version !== review.pin.version && <p role="status"><strong>{copy.updated.text}</strong> {copy.answersPinned.text} <a href={reviewHref(scope, latest)}>{copy.openUpdated.text}</a></p>}
    {review.request.status !== 'published' && <p>{copy.unavailable.text}</p>}
    {latest?.request.status === 'withdrawn' && review.request.status !== 'withdrawn' && <p role="status">{copy.withdrawn.text}</p>}
  </header>
    <div className="muted" data-ui="review-content-progress" hidden={!downloading && !failed}>{downloading ? <LoadingIndicator compact label={contentProgress} /> : contentProgress}</div>
    {failed > 0 && <button type="button" onClick={actions.retryContents}>{copy.retryContents.text}</button>}
    <button type="button" aria-expanded={sidebarOpen} aria-controls="review-items" onClick={actions.toggleSidebar}>{sidebarOpen ? copy.hideSidebar.text : copy.showSidebar.text}</button>
    <div className="review-layout review-detail-layout" data-sidebar-open={sidebarOpen}><div id="review-items" className="review-navigator" hidden={!sidebarOpen}><ReviewsDetailPresentation review={review} selected={selected} onSelect={actions.select} progress={progress} submitted={submitted} /></div>
      <article className="review-content"><h2>{member.label}</h2><ReviewMemberContent key={member.id} scope={scope} review={review} member={member} contents={contents} documentZen={documentZen}
        answer={submitted.has(member.id) ? responses.flatMap(item => item.value.forms).find(form => form.member_id === member.id) : forms.find(form => form.member_id === member.id)} submitted={submitted.has(member.id)}
        onAnswer={(answers, intent) => actions.answer(member.id, answers, intent)} onSubmit={() => actions.submit(member.id)} busy={busy || !accepting}
         onSaveDraft={actions.saveDraft} formStatus={{ notice, error, dirty, workflowAfterSubmit:Boolean(review.request.process) }}
         onNextForm={nextForm ? () => actions.select(nextForm.id) : undefined} onSubmitReview={() => actions.submit()}
        reviewed={progress.includes(member.id)} onReviewed={checked => actions.progress(member.id, checked)} />
      </article>
      <aside className="review-evidence" aria-label={copy.evidence.text}>
        <h2>{copy.evidence.text}</h2>
        {review.request.process && responses.filter(item=>item.value.reviewer===listing.reviewer).map(response=><ReviewWorkflow key={response.value.id} scope={scope} review={review} response={response} service={service} />)}
        <ReviewProcess scope={scope} review={review} service={service} />
        <details><summary>{copy.exactRevision.text}</summary><p>{review.request.revision_id}</p><code>{review.pin.version}</code><p>{review.pin.snapshot}</p><a href={reviewHref(scope, review)}>{copy.reopen.text}</a></details>
      </aside></div>
    <footer className="review-submit"><p role="status">{dirty ? copy.unsaved.text : ''}{notice}</p>{error && <p role="alert">{error}</p>}
      <p>{submissionNotice(review.request)}</p>
      <button disabled={busy || !accepting} onClick={actions.saveDraft}>{copy.saveDraft.text}</button><button disabled={busy || !accepting} onClick={() => actions.submit()}>{copy.submit.text}</button>
      <ul aria-label={copy.receipts.text}>{responses.map(item => <li key={item.value.id}>{item.value.forms.length}{copy.forms.text}{copy.separator.text}{item.value.comments.length}{copy.comments.text}
        <details><summary>{copy.submissionDetails.text}</summary><strong>{item.value.id}</strong><p><code>{item.pin.resource}</code></p><a href={evidenceHref(scope.repository, item.pin)}>{copy.exactResponse.text}</a><p><code>{item.pin.version}</code>{copy.separator.text}{copy.snapshot.text} <code>{item.pin.snapshot}</code></p></details>
        {review.request.process || review.request.response_effect ? <><p>{copy.responseSaved.text}{copy.separator.text}{review.request.process ? copy.dispatch.text : copy.notification.text} {item.dispatch?.state ?? copy.unknown.text}{copy.separator.text}{item.dispatch?.message ?? copy.missingDelivery.text}</p>{item.dispatch?.target && <a href={item.dispatch.target}>{review.request.process ? copy.workflowEvidence.text : copy.openVD.text}</a>}{item.dispatch?.attempted_at && <p>{copy.deliveryChecked.text} {item.dispatch.attempted_at}</p>}<ark.button data-ui="review-delivery-retry" disabled={busy || item.dispatch?.kind === 'vk' && ['dispatched', 'unknown'].includes(item.dispatch.state)} onClick={() => actions.retry(item.value)}>{copy.retryDelivery.text}</ark.button></> : listing.acknowledgements.includes(`${item.value.id}:${item.pin.version}`) ? copy.acknowledged.text : copy.pendingNotification.text}</li>)}</ul>
    </footer>
  </section>;
}

import type { OpenReview } from '../../../../hosted/reviews';
import type { ReviewArtifact } from '../../../../src/review-protocol';
import type { Answers } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1, StoredReviewArtifact } from '../../app-hooks/reviews';
import { ReviewMemberContent } from './ReviewMemberContent';
import { reviewHref } from './ReviewWorkspace';

interface Props {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing; latest?: OpenReview; service: ReviewsModuleV1;
  selected: string; forms: ReviewArtifact['forms']; progress: string[]; responses: StoredReviewArtifact[]; submitted: Set<string>;
  busy: boolean; dirty: boolean; notice: string; error: string;
  actions: { select(id: string): void; answer(id: string, answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; progress(id: string, checked: boolean): void; saveDraft(): void; submit(id?: string): void; refresh(): void };
}
export function ReviewSessionView({ scope, review, listing, latest, service, selected, forms, progress, responses, submitted, busy, dirty, notice, error, actions }: Props) {
  const member = review.request.members.find(member => member.id === selected)!;
  const accepting = review.request.status === 'published' && latest?.request.status !== 'withdrawn';
  return <section aria-label="Focused review session"><header className="review-summary"><p>{review.request.purpose}</p><p><strong>Requested response:</strong> {review.request.question}</p>
    <p>{review.request.change_kind === 'implemented' ? 'Implemented work' : review.request.change_kind === 'proposal' ? 'Proposed work' : 'Implemented and proposed work'} · {review.request.bead_id}</p>
    <details><summary>Exact review revision</summary><p>{review.request.revision_id}</p><code>{review.pin.version}</code><p>Snapshot: {review.pin.snapshot}</p><a href={reviewHref(scope, review)}>Reopen this exact packet</a></details>
    <button onClick={actions.refresh} disabled={busy}>Check for updates and receipts</button>
    {latest && latest.pin.version !== review.pin.version && <p role="status"><strong>Updated packet available.</strong> Your answers still refer to this revision. <a href={reviewHref(scope, latest)}>Open the updated packet separately</a></p>}
    {review.request.status !== 'published' && <p>This packet is {review.request.status}; response submission is unavailable.</p>}
    {latest?.request.status === 'withdrawn' && review.request.status !== 'withdrawn' && <p role="status">This request has been withdrawn. Existing responses remain available.</p>}
  </header>
    <div className="review-layout"><aside aria-label="Review items"><ol>{review.request.members.map(item => <li key={item.id}><button aria-current={selected === item.id ? 'step' : undefined} onClick={() => actions.select(item.id)}>{item.label}</button><span>{submitted.has(item.id) ? 'Submitted' : progress.includes(item.id) ? 'Reviewed' : item.kind}</span></li>)}</ol></aside>
      <article className="review-content"><h2>{member.label}</h2><ReviewMemberContent key={member.id} scope={scope} review={review} member={member} service={service}
        answer={submitted.has(member.id) ? responses.flatMap(item => item.value.forms).find(form => form.member_id === member.id) : forms.find(form => form.member_id === member.id)} submitted={submitted.has(member.id)}
        onAnswer={(answers, intent) => actions.answer(member.id, answers, intent)} onSubmit={() => actions.submit(member.id)} busy={busy || !accepting}
        onSaveDraft={actions.saveDraft} formStatus={{ notice, error, dirty }}
        reviewed={progress.includes(member.id)} onReviewed={checked => actions.progress(member.id, checked)} />
      </article></div>
    <footer className="review-submit"><p role="status">{dirty ? 'Unsaved changes. ' : ''}{notice}</p>{error && <p role="alert">{error}</p>}
      <button disabled={busy || !accepting} onClick={actions.saveDraft}>Save draft remotely</button><button disabled={busy || !accepting} onClick={() => actions.submit()}>Submit review feedback</button>
      <p>Answers are stored in workspace response artifacts. The task receives a pointer and summary.</p>
      <ul aria-label="Submission receipts">{responses.map(item => <li key={item.value.id}><strong>{item.value.id}</strong> · {item.value.forms.length} forms · {item.value.comments.length} comments<br /><code>{item.pin.resource}</code><br />
        {listing.acknowledgements.includes(`${item.value.id}:${item.pin.version}`) ? 'Task notification acknowledged' : 'Response saved; task notification pending'}</li>)}</ul>
    </footer>
  </section>;
}

import type { ReviewPacketProps } from './ReviewPacket';
import type { createReviewContents, ReviewContents } from './review-contents';
import { ReviewSession } from './ReviewSession';
import { recoveryKey } from './recovery';
import { ReviewMemberContent } from './ReviewMemberContent';

export function ReviewPacketView({ scope, review, listing, service, refresh, updateListing, error, contentsCache, contents, selected, onSelect }: ReviewPacketProps & {
  contentsCache: ReturnType<typeof createReviewContents>; contents: ReviewContents; selected: string; onSelect(id: string): void;
}) {
  if (listing) return <ReviewSession key={recoveryKey(scope, review, listing.reviewer)} scope={scope} review={review} listing={listing} service={service} refresh={refresh} updateListing={updateListing} contentsCache={contentsCache} contents={contents} initialSelected={selected} />;
  const member = review.request.members.find(item => item.id === selected)!;
  return <section aria-label="Pinned review preview">
    <header className="review-summary"><p>{review.request.purpose}</p><p><strong>Requested response:</strong> {review.request.question}</p>
      <p role="status">Loading your saved draft and response receipts. You can read the pinned review now; editing becomes available after restoration.</p>
      {error && <button type="button" onClick={refresh}>Retry loading saved review state</button>}
    </header>
    <div className="review-layout"><aside aria-label="Review items"><ol>{review.request.members.map(item => <li key={item.id}><button aria-current={selected === item.id ? 'step' : undefined} onClick={() => onSelect(item.id)}>{item.label}</button><span>{item.kind}</span></li>)}</ol></aside>
      <article className="review-content"><h2>{member.label}</h2><ReviewMemberContent key={member.id} scope={scope} review={review} member={member} contents={contents}
        submitted={false} busy preview reviewed={false} onReviewed={() => {}} onAnswer={() => {}} onSubmit={() => {}} />
      </article>
    </div>
  </section>;
}

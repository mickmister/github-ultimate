import type { ReviewPacketProps } from './ReviewPacket';
import type { createReviewContents, ReviewContents } from './review-contents';
import { ReviewSession } from './ReviewSession';
import { recoveryKey } from './recovery';
import { ReviewMemberContent } from './ReviewMemberContent';
import type { ReviewDocumentZen } from './contracts';
import { ReviewsDetailPresentation } from './ReviewsDetail.presentation';
import { reviewsCopy as copy } from './Reviews.copy';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

export function ReviewPacketView({ scope, review, listing, service, refresh, updateListing, error, contentsCache, contents, selected, onSelect, documentZen }: ReviewPacketProps & {
  contentsCache: ReturnType<typeof createReviewContents>; contents: ReviewContents; selected: string; onSelect(id: string): void;
  documentZen: ReviewDocumentZen;
}) {
  if (listing) return <ReviewSession key={recoveryKey(scope, review, listing.reviewer)} scope={scope} review={review} listing={listing} service={service} refresh={refresh} updateListing={updateListing} contentsCache={contentsCache} contents={contents} initialSelected={selected} documentZen={documentZen} />;
  const member = review.request.members.find(item => item.id === selected)!;
  return <section aria-label={copy.preview.text}>
    <header className="review-summary"><p>{review.request.purpose}</p><p><strong>{copy.requested.text}</strong> {review.request.question}</p>
      {!error && <LoadingIndicator compact label={copy.restoring.text} />}
      {error && <button type="button" onClick={refresh}>{copy.retryRestoration.text}</button>}
    </header>
    <div className="review-layout review-detail-layout"><div className="review-navigator"><ReviewsDetailPresentation review={review} selected={selected} onSelect={onSelect} progress={[]} submitted={new Set()} /></div>
      <article className="review-content"><h2>{member.label}</h2><ReviewMemberContent key={member.id} scope={scope} review={review} member={member} contents={contents} documentZen={documentZen}
        submitted={false} busy preview reviewed={false} onReviewed={() => {}} onAnswer={() => {}} onSubmit={() => {}} />
      </article>
    </div>
  </section>;
}

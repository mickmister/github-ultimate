import { useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { createReviewContents } from './review-contents';
import { ReviewPacketView } from './ReviewPacket.view';

export interface ReviewPacketProps {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing | null; service: ReviewsModuleV1;
  refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>>; error: string;
}

export function ReviewPacket(props: ReviewPacketProps) {
  const { scope, review, service } = props;
  const cache = useMemo(() => createReviewContents(scope, review, service), [scope.connectionId, scope.installationId, scope.repository, scope.workspace, review, service]);
  const contents = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const [selected, setSelected] = useState(review.request.members[0].id);
  useEffect(() => { void cache.preload(); }, [cache]);
  return <ReviewPacketView {...props} contentsCache={cache} contents={contents} selected={selected} onSelect={setSelected} />;
}

import type { Dispatch, SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { ReviewPacketView } from './ReviewPacket.view';
import { useReviewPacketFeature } from './ReviewPacket.hooks';

export interface ReviewPacketProps {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing | null; service: ReviewsModuleV1;
  refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>>; error: string;
}

export function ReviewPacket(props: ReviewPacketProps) {
  const model = useReviewPacketFeature(props);
  return <ReviewPacketView {...props} {...model} />;
}

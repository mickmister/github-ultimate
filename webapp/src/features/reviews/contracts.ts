import type { useReviewWorkspaceFeature } from './ReviewWorkspace.hooks';

export type ReviewWorkspaceModel = ReturnType<typeof useReviewWorkspaceFeature>;
export type { ReviewDocumentZen } from './ReviewPacket.hooks';

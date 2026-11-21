import type { AppHooksV1 } from '../../app-hooks/contracts';
import { useReviewWorkspaceFeature, type ReviewLocation } from './ReviewWorkspace.hooks';
import { ReviewWorkspaceView } from './ReviewWorkspace.view';
export { parseReviewSearch, reviewHref, type ReviewLocation } from './ReviewWorkspace.hooks';

export function ReviewWorkspace({ appHooks, location = {}, unifiedNavigation = false }: { appHooks?: AppHooksV1; location?: ReviewLocation; unifiedNavigation?: boolean }) {
  const model = useReviewWorkspaceFeature({ appHooks, location });
  return <ReviewWorkspaceView {...model} unifiedNavigation={unifiedNavigation} />;
}

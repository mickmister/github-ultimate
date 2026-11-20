import type { ReactNode } from 'react';
import type { FeedbackOptions } from './contracts';
import { createFeedbackQueue, feedbackStorageKey } from './queue';
import { FeedbackContext, useFeedbackModel, useParentFeedback } from './Feedback.hooks';
import { FeedbackShellView } from './FeedbackShell.view';

export { FeedbackContext, AttachableParentContext, useFeedback } from './Feedback.hooks';
type Props = FeedbackOptions & { children: ReactNode; storageKey?: string; queue?: ReturnType<typeof createFeedbackQueue>; uiSuppressed?: boolean };

/** Retain above the outlet; suppress global controls while a review owns its queue. */
export function FeedbackProvider({ children, includePageUrl = false, storageKey = feedbackStorageKey, queue, uiSuppressed = false }: Props) {
  const parent = useParentFeedback();
  return parent && !queue ? <>{children}</> : <FeedbackRoot key={storageKey} includePageUrl={includePageUrl} storageKey={storageKey} queue={queue} uiSuppressed={uiSuppressed}>{children}</FeedbackRoot>;
}

function FeedbackRoot({ children, includePageUrl = false, storageKey = feedbackStorageKey, queue, uiSuppressed }: Props) {
  const model = useFeedbackModel({ includePageUrl, storageKey, providedQueue: queue, uiSuppressed });
  return <FeedbackContext.Provider value={model.api}><FeedbackShellView {...model} uiSuppressed={uiSuppressed}>{children}</FeedbackShellView></FeedbackContext.Provider>;
}

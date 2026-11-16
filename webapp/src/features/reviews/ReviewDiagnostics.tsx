import { useSyncExternalStore } from 'react';
import { reviewPerf } from '../../../../hosted/performance';
import { ReviewDiagnosticsView } from './ReviewDiagnostics.view';

export function ReviewDiagnostics() {
  useSyncExternalStore(reviewPerf.subscribe, reviewPerf.snapshot, () => 0);
  return <ReviewDiagnosticsView status={reviewPerf.status()} summary={reviewPerf.summary()} actions={reviewPerf} />;
}

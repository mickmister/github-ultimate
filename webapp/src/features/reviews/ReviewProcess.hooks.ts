import { useEffect, useState } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import { processMetadata, type ProcessEvidence } from '../../../../hosted/review-process';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewsModuleV1 } from '../../app-hooks/reviews';

export function useReviewProcessFeature({ scope, review, service }: { scope: WorkspaceScope; review: OpenReview; service: ReviewsModuleV1 }) {
  const [state, setState] = useState<{ loading: boolean; evidence: ProcessEvidence[]; error?: string; checked?: string }>({ loading: true, evidence: [] });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, evidence: [] });
    const process = review.request.process;
    if (!process) return;
    const pins = [{ label: 'QRSPI config', pin: process.config }, ...review.request.members.filter(member => member.kind === 'document').filter(member => member.target.resource !== process.config.resource).map(member => ({ label: member.label, pin: member.target }))];
    void Promise.all(pins.map(async ({ label, pin }) => {
      let metadata = 'Pinned metadata unavailable; position unknown';
      try { metadata = processMetadata(await service.read(scope, pin)); }
      catch (error) { return { label, pin, metadata, error: String(error) }; }
      try {
        const current = await service.current?.(scope, pin.resource);
        return { label, pin, metadata, current: current ? { pin: current.pin, metadata: processMetadata(current.text) } : current };
      } catch (error) { return { label, pin, metadata, error: `Current evidence unavailable: ${String(error)}` }; }
    })).then(evidence => { if (!cancelled) setState({ loading: false, evidence, checked: new Date().toISOString() }); }, error => { if (!cancelled) setState({ loading: false, evidence: [], error: String(error) }); });
    return () => { cancelled = true; };
  }, [scope, review, service]);
  return state;
}

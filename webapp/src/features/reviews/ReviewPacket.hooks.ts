import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createReviewContents } from './review-contents';
import type { ReviewPacketProps } from './ReviewPacket';

export interface ReviewDocumentZen {
  member: string | null;
  setMember(member: string | null): void;
  modes: Readonly<Record<string, 'full' | 'baseline' | 'changes'>>;
  setMode(member: string, mode: 'full' | 'baseline' | 'changes'): void;
}

/** Reading preferences outlive the preview-to-restored-session transition. */
export function useReviewDocumentZen(): ReviewDocumentZen {
  const [member, setMember] = useState<string | null>(null);
  const [modes, setModes] = useState<ReviewDocumentZen['modes']>({});
  return { member, setMember, modes, setMode: (id, mode) => setModes(current => ({ ...current, [id]: mode })) };
}

export function useReviewPacketFeature({ scope, review, service }: ReviewPacketProps) {
  const cache = useMemo(() => createReviewContents(scope, review, service), [scope.connectionId, scope.installationId, scope.repository, scope.workspace, review, service]);
  const contents = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const [selected, setSelected] = useState(review.request.members[0].id);
  const documentZen = useReviewDocumentZen();
  useEffect(() => { void cache.preload(); }, [cache]);
  return { contentsCache: cache, contents, selected, onSelect: setSelected, documentZen };
}

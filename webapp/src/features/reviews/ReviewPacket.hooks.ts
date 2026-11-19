import { useState } from 'react';

export interface ReviewDocumentZen {
  member: string | null;
  setMember(member: string | null): void;
}

/** Reading preferences outlive the preview-to-restored-session transition. */
export function useReviewDocumentZen(): ReviewDocumentZen {
  const [member, setMember] = useState<string | null>(null);
  return { member, setMember };
}

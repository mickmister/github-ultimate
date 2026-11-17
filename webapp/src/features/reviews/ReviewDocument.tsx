import { useState, type ReactNode } from 'react';
import type { ReviewFormProps } from './ReviewForm.view';
import { ReviewDocumentView } from './ReviewDocument.view';
import { useReviewZen } from './useReviewZen';

export interface ReviewDocumentProps {
  title: string; children: ReactNode; busy: boolean;
  onSaveDraft?(): void; formStatus?: ReviewFormProps['formStatus'];
}

export function ReviewDocument(props: ReviewDocumentProps) {
  const [zen, setZen] = useState(false);
  const refs = useReviewZen<HTMLHeadingElement>(zen);
  return <ReviewDocumentView {...props} {...refs} zen={zen} onZen={setZen} />;
}

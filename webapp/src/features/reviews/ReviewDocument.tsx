import type { ReactNode } from 'react';
import type { ReviewFormProps } from './ReviewForm.view';
import { ReviewDocumentView } from './ReviewDocument.view';
import { useReviewZen } from './useReviewZen';

export interface ReviewDocumentProps {
  title: string; children: ReactNode; busy: boolean;
  zen: boolean; onZen(value: boolean): void;
  onSaveDraft?(): void; formStatus?: ReviewFormProps['formStatus'];
}

export function ReviewDocument(props: ReviewDocumentProps) {
  const refs = useReviewZen<HTMLHeadingElement>(props.zen);
  return <ReviewDocumentView {...props} {...refs} />;
}

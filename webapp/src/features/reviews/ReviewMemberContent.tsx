import { useMemo, useState } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ReviewArtifact, ReviewMember } from '../../../../src/review-protocol';
import { parseRecord, type Answers, type TaskForm } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import { ReviewMemberContentView } from './ReviewMemberContent.view';
import type { ReviewFormProps } from './ReviewForm.view';
import { reviewResourceKey, type ReviewContents } from './review-contents';

export interface ReviewMemberContentProps {
  scope: WorkspaceScope; review: OpenReview; member: ReviewMember; contents: ReviewContents;
  answer?: ReviewArtifact['forms'][number]; submitted: boolean; busy: boolean;
  preview?: boolean;
  reviewed: boolean; onReviewed(checked: boolean): void;
  onAnswer(answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; onSubmit(): void;
  onSaveDraft?(): void; formStatus?: ReviewFormProps['formStatus'];
}
export function ReviewMemberContent(props: ReviewMemberContentProps) {
  const { member, contents } = props;
  const resource = contents.get(reviewResourceKey(member.kind === 'document' ? member.target : member.dsl));
  const before = member.kind === 'document' && member.baseline ? contents.get(reviewResourceKey(member.baseline)) : undefined;
  const content = resource?.status === 'ready' ? resource.text : null;
  const baseline = before?.status === 'ready' ? before.text : null;
  const baselineError = before?.status === 'error' ? `Pinned baseline unavailable: ${before.error}` : '';
  const parsed = useMemo((): { form: TaskForm | null; error: string } => {
    if (member.kind !== 'form' || content === null) return { form: null, error: '' };
    try {
      const record = parseRecord(content);
      if (!('format' in record) || record.id !== member.form_id || record.task_id && record.task_id !== member.bead_id || record.invalidatedAt) throw new Error('Pinned form identity is invalid or withdrawn.');
      return { form: record, error: '' };
    } catch (cause) { return { form: null, error: String(cause) }; }
  }, [member, content]);
  const error = resource?.status === 'error' ? resource.error : parsed.error;
  const [mode, setMode] = useState<'full' | 'baseline' | 'changes'>('full');
  return <ReviewMemberContentView {...props} content={content} baseline={baseline} form={parsed.form} error={error} baselineError={baselineError} mode={mode} setMode={setMode} />;
}

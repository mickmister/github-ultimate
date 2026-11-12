import { useEffect, useState } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import type { ReviewArtifact, ReviewMember } from '../../../../src/review-protocol';
import { parseRecord, type Answers, type TaskForm } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewsModuleV1 } from '../../app-hooks/reviews';
import { ReviewMemberContentView } from './ReviewMemberContent.view';
import type { ReviewFormProps } from './ReviewForm.view';

export interface ReviewMemberContentProps {
  scope: WorkspaceScope; review: OpenReview; member: ReviewMember; service: ReviewsModuleV1;
  answer?: ReviewArtifact['forms'][number]; submitted: boolean; busy: boolean;
  reviewed: boolean; onReviewed(checked: boolean): void;
  onAnswer(answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; onSubmit(): void;
  onSaveDraft?(): void; formStatus?: ReviewFormProps['formStatus'];
}
export function ReviewMemberContent(props: ReviewMemberContentProps) {
  const { scope, member, service } = props;
  const [content, setContent] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [error, setError] = useState('');
  const [baselineError, setBaselineError] = useState('');
  const [mode, setMode] = useState<'full' | 'baseline' | 'changes'>('full');
  useEffect(() => {
    let cancelled = false;
    setContent(null); setBaseline(null); setForm(null); setError(''); setBaselineError('');
    const pin = member.kind === 'document' ? member.target : member.dsl;
    void service.read(scope, pin).then(text => {
      if (cancelled) return;
      if (member.kind === 'form') {
        const record = parseRecord(text);
        if (!('format' in record) || record.id !== member.form_id || record.task_id && record.task_id !== member.bead_id || record.invalidatedAt) throw new Error('Pinned form identity is invalid or withdrawn.');
        setForm(record);
      }
      setContent(text);
    }).catch(cause => { if (!cancelled) setError(String(cause)); });
    if (member.kind === 'document' && member.baseline) void service.read(scope, member.baseline).then(text => { if (!cancelled) setBaseline(text); }).catch(cause => { if (!cancelled) setBaselineError(`Pinned baseline unavailable: ${String(cause)}`); });
    return () => { cancelled = true; };
  }, [service, scope, member]);
  return <ReviewMemberContentView {...props} content={content} baseline={baseline} form={form} error={error} baselineError={baselineError} mode={mode} setMode={setMode} />;
}

import type { TaskForm } from '../../../../src/protocol';
import { AttachableContext } from '../feedback/AttachableContext';
import { FeedbackAnnotations } from '../feedback/FeedbackAnnotations';
import { MarkdownDocument } from '../documents/MarkdownDocument';
import { MonacoDocument } from '../documents/MonacoDocument';
import { isMarkdown } from '../documents/document-format';
import { DocumentChanges } from './DocumentChanges';
import { ReviewFormView } from './ReviewForm.view';
import { reviewTarget } from './model';
import type { ReviewMemberContentProps } from './ReviewMemberContent';

interface Props extends ReviewMemberContentProps { content: string | null; baseline: string | null; form: TaskForm | null; error: string; baselineError: string; mode: 'full' | 'baseline' | 'changes'; setMode(mode: 'full' | 'baseline' | 'changes'): void }
export function ReviewMemberContentView({ scope, review, member, answer, submitted, busy, onAnswer, onSubmit, content, baseline, form, error, baselineError, mode, setMode }: Props) {
  if (error) return <p role="alert">{error}</p>;
  if (content === null) return <p role="status">Loading {member.label}…</p>;
  if (member.kind === 'form' && form) return <ReviewFormView form={form} answer={answer} submitted={submitted} busy={busy} onAnswer={onAnswer} onSubmit={onSubmit} />;
  if (member.kind !== 'document') return null;
  const markdown = isMarkdown(member.target.resource);
  const target = reviewTarget(scope, review, member, markdown ? 'rendered-markdown' : 'source');
  return <section aria-label="Pinned document review"><div role="group" aria-label="Document comparison view"><button aria-pressed={mode === 'full'} onClick={() => setMode('full')}>Full document</button>
    {member.baseline && <><button aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>Changes</button><button aria-pressed={mode === 'baseline'} onClick={() => setMode('baseline')}>Baseline</button></>}</div>
    <p className="muted">{member.target.resource}</p>
    {mode !== 'full' && (baselineError ? <p role="alert">{baselineError}</p> : baseline === null ? <p role="status">Loading pinned baseline…</p> : mode === 'changes'
      ? <DocumentChanges path={member.target.resource} before={baseline} after={content} />
      : markdown ? <MarkdownDocument content={baseline} /> : <MonacoDocument path={member.baseline!.resource} content={baseline} />)}
    {mode === 'full' && <AttachableContext target={target}><FeedbackAnnotations target={target}>
      {markdown ? <MarkdownDocument content={content} /> : <MonacoDocument path={member.target.resource} content={content} />}
    </FeedbackAnnotations></AttachableContext>}
  </section>;
}

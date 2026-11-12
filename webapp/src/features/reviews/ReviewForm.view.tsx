import type { TaskForm, Answers } from '../../../../src/protocol';
import type { ReviewArtifact } from '../../../../src/review-protocol';
import { choiceOptions } from '../../../../src/choices';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ReviewCheckbox } from './ReviewCheckbox.view';

export interface ReviewFormProps {
  form: TaskForm; answer?: ReviewArtifact['forms'][number]; submitted: boolean; busy: boolean;
  onAnswer(answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; onSubmit(): void;
  onSaveDraft?(): void; formStatus?: { notice: string; error: string; dirty: boolean };
}
export function ReviewFormView({ form, answer, submitted, busy, onAnswer, onSubmit, onSaveDraft, formStatus, step, heading, onStep, zen, onZen, dialog, zenButton }: ReviewFormProps & {
  step: number; heading: RefObject<HTMLHeadingElement | null>; onStep(step: number): void;
  zen: boolean; onZen(value: boolean): void; dialog: RefObject<HTMLDialogElement | null>; zenButton: RefObject<HTMLButtonElement | null>;
}) {
  const answers = answer?.answers ?? {};
  const intent = answer?.intent ?? 'discussion';
  const question = form.questions[step];
  const content = <form className="review-form" onSubmit={event => { event.preventDefault(); if (!question) onSubmit(); }}><h3>{form.title}</h3>{form.goal && <p>{form.goal}</p>}{form.description && <p className="review-description">{form.description}</p>}
    <p className="muted">{question ? `Question ${step + 1} of ${form.questions.length}` : 'Finish response'}</p>
    <h4 ref={heading} tabIndex={-1} className="review-question-heading">{question ? `${question.title}${question.required ? ' (required)' : ''}` : 'Finish and submit'}</h4>
    <fieldset disabled={submitted || busy}><legend>{submitted ? 'Submitted for this revision' : 'Your response'}</legend>
      {question ? <section key={question.id} aria-label={question.title}><p className="review-description">{question.description}</p>
        {question.type === 'choices' ? <div>{choiceOptions(form, question).map(choice => <div className="review-choice" key={choice.id}><ReviewCheckbox label={choice.label} disabled={submitted || busy} checked={typeof answers[question.id] === 'object' && Boolean((answers[question.id] as Record<string, boolean>)[choice.id])}
          onChange={checked => {
            const selected = { ...(typeof answers[question.id] === 'object' ? answers[question.id] as Record<string, boolean> : {}), [choice.id]: checked };
            if (checked) for (const group of question.choiceGroups ?? []) if (group.mode !== 'any' && group.choiceIds.includes(choice.id)) for (const id of group.choiceIds) if (id !== choice.id) selected[id] = false;
            onAnswer({ ...answers, [question.id]: selected }, intent);
          }} />{choice.description && <p>{choice.description}</p>}{choice.is_recommended_reason && <p>Recommendation: {choice.is_recommended_reason}</p>}
          {choice.prosAndCons && <><ul>{choice.prosAndCons.pros?.map((pro, index) => <li key={index}>Pro: {pro}</li>)}</ul><ul>{choice.prosAndCons.cons?.map((con, index) => <li key={index}>Con: {con}</li>)}</ul></>}
          <label>Notes for {choice.label}<textarea value={typeof answers[`${question.id}_${choice.id}_more_info`] === 'string' ? answers[`${question.id}_${choice.id}_more_info`] as string : ''} onChange={event => onAnswer({ ...answers, [`${question.id}_${choice.id}_more_info`]: event.target.value }, intent)} /></label>
        </div>)}</div> : <label>{question.title}<textarea placeholder={question.placeholder} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => onAnswer({ ...answers, [question.id]: event.target.value }, intent)} /></label>}
        {question.id !== 'additional_notes' && <label>Additional context for {question.title}<textarea value={typeof answers[`${question.id}_more_info`] === 'string' ? answers[`${question.id}_more_info`] as string : ''} onChange={event => onAnswer({ ...answers, [`${question.id}_more_info`]: event.target.value }, intent)} /></label>}
      </section> : <>
      {!form.questions.some(question => question.id === 'additional_notes') && <label>Additional notes<textarea value={typeof answers.additional_notes === 'string' ? answers.additional_notes : ''} onChange={event => onAnswer({ ...answers, additional_notes: event.target.value }, intent)} /></label>}
      <label>Next instruction<textarea value={typeof answers.next_instruction === 'string' ? answers.next_instruction : ''} onChange={event => onAnswer({ ...answers, next_instruction: event.target.value }, intent)} /></label>
      {form.allowCodeFileChanges !== false && <div>{form.allowCodeFileChanges?.description && <p>{form.allowCodeFileChanges.description}</p>}<ReviewCheckbox disabled={submitted || busy} checked={intent === 'approved-next-steps'} onChange={checked => onAnswer(answers, checked ? 'approved-next-steps' : 'discussion')} label={form.allowCodeFileChanges?.label ?? form.allowCodeFileChanges?.allowLabel ?? 'Allow code-file changes for these next steps'} /></div>}
      <button type="submit">Submit this form</button>
      </>}
    </fieldset>
    <nav className="review-question-navigation" aria-label="Form questions">
      <button type="button" disabled={busy || step === 0} onClick={() => onStep(step - 1)}>Previous question</button>
      {question && <button type="button" disabled={busy} onClick={() => onStep(step + 1)}>{step + 1 < form.questions.length ? 'Next question' : 'Continue to submission'}</button>}
    </nav>
    {zen && <div className="review-form-actions">
      {onSaveDraft && <button type="button" disabled={busy || submitted} onClick={onSaveDraft}>Save draft remotely</button>}
      {formStatus && <><p role="status">{busy ? 'Saving response…' : `${formStatus.dirty && !submitted ? 'Unsaved changes. ' : ''}${formStatus.notice}`}</p>{formStatus.error && <p role="alert">{formStatus.error}</p>}</>}
    </div>}
  </form>;
  return zen ? createPortal(<dialog ref={dialog} className="review-zen" aria-label={`${form.title} — Zen mode`} onCancel={event => { event.preventDefault(); onZen(false); }}>
    <header className="review-zen-toolbar"><button type="button" className="review-zen-back" onClick={() => onZen(false)}>← Back</button></header>
    <div className="review-zen-content">{content}</div>
  </dialog>, document.body) : <><button ref={zenButton} type="button" className="review-zen-toggle" onClick={() => onZen(true)}>Zen mode</button>{content}</>;
}

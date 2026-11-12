import type { TaskForm, Answers } from '../../../../src/protocol';
import type { ReviewArtifact } from '../../../../src/review-protocol';
import { choiceOptions } from '../../../../src/choices';

export function ReviewFormView({ form, answer, submitted, busy, onAnswer, onSubmit }: { form: TaskForm; answer?: ReviewArtifact['forms'][number]; submitted: boolean; busy: boolean; onAnswer(answers: Answers, intent: 'discussion' | 'approved-next-steps'): void; onSubmit(): void }) {
  const answers = answer?.answers ?? {};
  const intent = answer?.intent ?? 'discussion';
  return <form className="review-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}><h3>{form.title}</h3>{form.goal && <p>{form.goal}</p>}{form.description && <p className="review-description">{form.description}</p>}
    <fieldset disabled={submitted || busy}><legend>{submitted ? 'Submitted for this revision' : 'Your response'}</legend>
      {form.questions.map(question => <section key={question.id}><h4>{question.title}{question.required ? ' (required)' : ''}</h4><p className="review-description">{question.description}</p>
        {question.type === 'choices' ? <div>{choiceOptions(form, question).map(choice => <div className="review-choice" key={choice.id}><label><input type="checkbox" checked={typeof answers[question.id] === 'object' && Boolean((answers[question.id] as Record<string, boolean>)[choice.id])}
          onChange={event => {
            const selected = { ...(typeof answers[question.id] === 'object' ? answers[question.id] as Record<string, boolean> : {}), [choice.id]: event.target.checked };
            if (event.target.checked) for (const group of question.choiceGroups ?? []) if (group.mode !== 'any' && group.choiceIds.includes(choice.id)) for (const id of group.choiceIds) if (id !== choice.id) selected[id] = false;
            onAnswer({ ...answers, [question.id]: selected }, intent);
          }} />{choice.label}</label>{choice.description && <p>{choice.description}</p>}{choice.is_recommended_reason && <p>Recommendation: {choice.is_recommended_reason}</p>}
          {choice.prosAndCons && <><ul>{choice.prosAndCons.pros?.map((pro, index) => <li key={index}>Pro: {pro}</li>)}</ul><ul>{choice.prosAndCons.cons?.map((con, index) => <li key={index}>Con: {con}</li>)}</ul></>}
          <label>Notes for {choice.label}<textarea value={typeof answers[`${question.id}_${choice.id}_more_info`] === 'string' ? answers[`${question.id}_${choice.id}_more_info`] as string : ''} onChange={event => onAnswer({ ...answers, [`${question.id}_${choice.id}_more_info`]: event.target.value }, intent)} /></label>
        </div>)}</div> : <label>{question.title}<textarea placeholder={question.placeholder} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => onAnswer({ ...answers, [question.id]: event.target.value }, intent)} /></label>}
        {question.id !== 'additional_notes' && <label>Additional context for {question.title}<textarea value={typeof answers[`${question.id}_more_info`] === 'string' ? answers[`${question.id}_more_info`] as string : ''} onChange={event => onAnswer({ ...answers, [`${question.id}_more_info`]: event.target.value }, intent)} /></label>}
      </section>)}
      {!form.questions.some(question => question.id === 'additional_notes') && <label>Additional notes<textarea value={typeof answers.additional_notes === 'string' ? answers.additional_notes : ''} onChange={event => onAnswer({ ...answers, additional_notes: event.target.value }, intent)} /></label>}
      <label>Next instruction<textarea value={typeof answers.next_instruction === 'string' ? answers.next_instruction : ''} onChange={event => onAnswer({ ...answers, next_instruction: event.target.value }, intent)} /></label>
      {form.allowCodeFileChanges !== false && <div>{form.allowCodeFileChanges?.description && <p>{form.allowCodeFileChanges.description}</p>}<label><input type="checkbox" checked={intent === 'approved-next-steps'} onChange={event => onAnswer(answers, event.target.checked ? 'approved-next-steps' : 'discussion')} />{form.allowCodeFileChanges?.label ?? form.allowCodeFileChanges?.allowLabel ?? 'Allow code-file changes for these next steps'}</label></div>}
      <button type="submit">Submit this form</button>
    </fieldset>
  </form>;
}

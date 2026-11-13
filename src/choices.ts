import type { Question, TaskForm } from './protocol.ts';

type Choices = Extract<Question, { type: 'choices' }>;

/** Derived UI/answer options; never rewrite the source form or its revision. */
export function choiceOptions(form: Pick<TaskForm, 'questions'>, question: Choices): Choices['choices'] {
  if (question.choices.some(choice => choice.id === 'other' || /^other\b/i.test(choice.label.trim()))) return question.choices;
  const names = new Set(form.questions.flatMap(q => [q.id, `${q.id}_more_info`,
    ...(q.type === 'choices' ? q.choices.map(c => `${q.id}_${c.id}_more_info`) : [])]));
  let id = 'other';
  for (let suffix = 2; question.choices.some(c => c.id === id) || names.has(`${question.id}_${id}_more_info`); suffix++) id = `other_${suffix}`;
  return [...question.choices, { id, label: 'Other' }];
}

export function isOtherChoice(choice: Choices['choices'][number]): boolean {
  return choice.id === 'other' || /^other\b/i.test(choice.label.trim());
}

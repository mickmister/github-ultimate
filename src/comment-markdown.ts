import type { TaskForm, Answers } from './protocol.ts';
import { choiceOptions } from './choices.ts';

export function inlineText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>#])/g, '\\$1');
}
const quote = (value: string) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;').split(/\r?\n/).map(line => `> ${line}`).join('\n');

export function formMarkdown(form: TaskForm): string {
  const lines = [`### ${inlineText(form.title)}`, ''];
  if (form.goal) lines.push(`**Goal:** ${inlineText(form.goal)}`, '');
  if (form.description) lines.push(form.description, '');
  for (const [index, q] of form.questions.entries()) {
    lines.push(`#### ${index + 1}. ${inlineText(q.title)}`, '');
    if (q.description) lines.push(q.description, '');
    if (q.type === 'choices') for (const choice of q.choices) {
      lines.push(`- [ ] **${inlineText(choice.label)}**${choice.description ? ` — ${inlineText(choice.description)}` : ''}`);
      if (choice.is_recommended_reason) lines.push(`  - Recommended: ${inlineText(choice.is_recommended_reason)}`);
      for (const [kind, items] of Object.entries(choice.prosAndCons ?? {})) for (const item of items ?? []) lines.push(`  - ${kind === 'pros' ? 'Pro' : 'Con'}: ${inlineText(item)}`);
    }
    else lines.push('_Free-text answer._');
    if (q.required) lines.push('', '_Answer requested; you may leave it unanswered if it no longer applies._');
    lines.push('');
  }
  return lines.join('\n');
}

export function answersMarkdown(form: TaskForm, answers: Answers, questionId?: string): string {
  const lines: string[] = [];
  for (const q of form.questions) {
    if (questionId && q.id !== questionId) continue;
    lines.push(`**${inlineText(q.title)}**`, '');
    const value = answers[q.id];
    if (q.type === 'choices') {
      const choices = choiceOptions(form, q);
      const selected = value && typeof value === 'object' ? choices.filter(c => value[c.id]).map(c => c.label) : [];
      lines.push(selected.length ? quote(selected.join(', ')) : '_No selection._', '');
      for (const c of choices) {
        const note = answers[`${q.id}_${c.id}_more_info`];
        if (typeof note === 'string' && note.trim()) lines.push(`Note on ${inlineText(c.label)}:`, quote(note), '');
      }
    } else lines.push(typeof value === 'string' && value.trim() ? quote(value) : '_Unanswered._', '');
    const note = answers[`${q.id}_more_info`];
    if (typeof note === 'string' && note.trim()) lines.push('Question note:', quote(note), '');
  }
  if (!questionId && !form.questions.some(q => q.id === 'additional_notes') && typeof answers.additional_notes === 'string' && answers.additional_notes.trim()) lines.push('**Additional notes**', '', quote(answers.additional_notes), '');
  if (!questionId && typeof answers.next_instruction === 'string' && answers.next_instruction.trim()) lines.push('**Next instruction**', '', quote(answers.next_instruction), '');
  return lines.join('\n');
}

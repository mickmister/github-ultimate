import type { Answers, ResponseRecord, Snapshot, TaskForm } from '../src/protocol';

export const form = {
  format: 'standard', version: 1, id: 'storybook_plan', task_id: 'storybook-task',
  session_id: 'storybook-session', title: 'Plan the next change',
  goal: 'Explore the real extension form, including Other, notes, review and native comment composition.',
  description: 'These are **fictional fixtures**. Nothing is sent to GitHub and no agent runs. Try typing `m`, opening notes, switching questions, and opening zen.',
  questions: [
    { id: 'approach', title: 'What kind of change should we make?', type: 'choices', description: 'The author suggests one option, but every checkbox remains independent. Other is added by the shipping renderer.', required: true,
      choices: [
        { id: 'focused', label: 'A small focused change', description: 'Fix the immediate problem first.', is_recommended_reason: 'Faster review and verification.', prosAndCons: { pros: ['Small diff', 'Fast feedback'], cons: ['May leave broader cleanup for later'] } },
        { id: 'investigate', label: 'A broader investigation', description: 'Explore the surrounding behavior before choosing a fix.', assumedTrue: true },
      ], choiceGroups: [{ id: 'suggested', title: 'Suggested direction', mode: 'exactlyOne', choiceIds: ['focused', 'investigate'] }] },
    { id: 'context', type: 'textarea', title: 'What context matters?', required: true, description: 'Use this field to try text selection, keyboard input, or the mobile software keyboard.', placeholder: 'Explain what you observed and what should happen.' },
    { id: 'verification', type: 'text', title: 'How should we verify it?', description: '', placeholder: 'For example: test in Chrome and Safari.' },
    { id: 'additional_notes', type: 'textarea', title: 'Additional notes', description: 'Global notes stay outside the wizard question count.' },
  ],
  nextInstructionPresets: [{ label: 'Discuss the approach', value: 'Ask follow-up questions before implementing.' }],
} satisfies TaskForm;

export const filled: Answers = {
  approach: { focused: true, investigate: true, other: true },
  approach_other_more_info: 'Combine the approaches, then verify on both layouts.',
  approach_focused_more_info: 'Keep the first patch small.',
  context: 'The two browsers receive different comment markup. Typing m should stay in this field.',
  verification: 'Exercise both layouts and preserve the original comment draft.',
  additional_notes: 'This is a seeded demo draft, not a real user conversation.',
};

export const source = { repository: 'example/project', number: 42, comment_id: 'storybook-comment', revision: 'a'.repeat(64) };

export function response(answers: Answers = filled, approved = false, index = 1): ResponseRecord {
  return {
    kind: 'response', schema_version: 1, response_id: `storybook-response-${index}`,
    task_id: form.task_id, form_id: form.id, session_id: form.session_id, parent_task_id: null,
    source, intent: approved ? 'approved-next-steps' : 'discussion', resume_session: true,
    allow_code_file_changes: approved, answers,
  };
}

export const snapshot: Snapshot = {
  kind: 'workflow', schema_version: 1, task_id: 'storybook-task', title: 'Verify GitHub comment discovery',
  status: 'running', session_id: 'storybook-session', attempt_id: 'storybook-attempt',
  updated_at: '2026-11-07T12:00:00Z', summary: 'Saved comment-provided progress. This story does not run or poll a workflow.',
  run_url: 'https://github.com/example/project/actions/runs/42',
  dashboard_url: 'https://runner.demo.ts.net/', dashboard_status: 'available',
  beads: [
    { id: 'demo.1', title: 'Reproduce both layouts', status: 'closed' },
    { id: 'demo.2', title: 'Implement and verify discovery', status: 'in_progress', dependencies: ['demo.1'] },
    { id: 'demo.3', title: 'Install and test on the second machine', status: 'open', dependencies: ['demo.2'] },
  ],
};

// Keep JSON as data for Storybook's expandable tree/RAW controls. Serialize at
// the renderer boundary, so the inspector and the rendered record cannot drift.
export const json = <T extends object>(value: T): T => structuredClone(value);

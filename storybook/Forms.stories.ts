import type { Meta, StoryObj } from '@storybook/html-vite';
import { form, filled, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const meta = {
  title: 'Forms', render: renderRecord, argTypes: controls,
  args: { ...baseArgs, source: json(form) },
} satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const Pending: Story = {};
export const MultipleSelectionsAndOther: Story = { args: { seed: filled } };
export const FilledDraft: Story = { args: { seed: filled, stage: 'question-two' } };
export const ReviewWithOmissions: Story = { args: { stage: 'review' } };
export const FilledReview: Story = { args: { stage: 'review', seed: filled } };
export const ResponsePreview: Story = { args: { stage: 'preview', seed: filled } };
export const Zen: Story = { args: { stage: 'zen', seed: filled } };
export const Phone: Story = { args: { width: 'phone', seed: filled } };
export const DarkPhone: Story = { args: { width: 'phone', theme: 'dark', seed: filled } };
export const Submitted: Story = { args: { stage: 'submitted', seed: filled } };
export const SubmissionHistory: Story = { args: { stage: 'history', seed: filled } };
export const NewResponse: Story = { args: { stage: 'new-response', seed: filled } };
export const Superseded: Story = { args: { source: json({ ...form, invalidatedAt: '2026-11-07T12:00:00Z', invalidatedReason: 'A newer decision replaces this form.' }) } };
export const DiscussionOnly: Story = { args: { source: json({ ...form, allowCodeFileChanges: false }), stage: 'review', seed: filled } };
export const SingleQuestion: Story = { args: { source: json({ ...form, id: 'one_question', title: 'A quick follow-up', questions: [{ id: 'followup', type: 'textarea', title: 'What should happen next?', description: 'A single question has no wizard.' }] }) } };
export const AuthoredOther: Story = { args: { source: json({ ...form, questions: [{ ...form.questions[0], choices: [...form.questions[0].choices!, { id: 'custom', label: 'Other (please explain)' }] }] }) } };
export const YamlFollowup: Story = { args: { source: '---\nformat: standard\nid: yaml_followup\ntitle: YAML follow-up\nallowCodeFileChanges: false\nquestions:\n  - id: followup\n    type: textarea\n    title: What needs clarification?\n---\nSafe **Markdown** context, authored as YAML frontmatter.' } };
export const LongContent: Story = { args: { width: 'phone', source: json({ ...form, title: 'An architectural question with a deliberately long title to exercise narrow-screen wrapping and touch layout', questions: [{ id: 'directions', type: 'choices', title: 'Which directions are worth investigating?', description: 'Long labels and paragraphs should remain readable. Open notes and try zen.', choices: Array.from({ length: 12 }, (_, index) => ({ id: `direction_${index}`, label: `Direction ${index + 1}: investigate a deliberately long option label on a small screen`, description: 'This explanatory paragraph exercises wrapping without truncating the author’s context or covering the choice controls.' })) }] }) } };
export const StorageUnavailable: Story = { args: { seed: filled, storageFailure: true } };

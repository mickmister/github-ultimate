import type { Meta, StoryObj } from '@storybook/html-vite';
import type { TaskForm } from '../src/protocol';
import { form, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const topics = ['Scope', 'Dependencies', 'Compatibility', 'Verification', 'Rollout', 'Recovery'];
function manyQuestions(count: number): TaskForm {
  return {
    ...form, id: `stress_${count}_questions`, title: `${count}-question planning session`,
    goal: 'Explore a crowded question index, jump to the final question, and review skipped answers.',
    description: 'Synthetic stress fixture. Global notes are not counted as a wizard question.',
    questions: [
      ...Array.from({ length: count }, (_, index) => ({
        id: `question_${index + 1}`, type: 'textarea' as const,
        title: `${topics[index % topics.length]} checkpoint ${index + 1}`,
        description: `Explain the decision for checkpoint ${index + 1}, or skip it if it no longer applies.`,
        required: true,
      })),
      ...(count < 60 ? [{ id: 'additional_notes', type: 'textarea' as const, title: 'Additional notes', description: 'Context for the entire planning session.' }] : []),
    ],
  };
}

const thirtyQuestions = manyQuestions(30);
const meta = {
  title: 'Corner cases', render: renderRecord, argTypes: controls,
  args: { ...baseArgs, source: json(thirtyQuestions) },
} satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const ThirtyQuestions: Story = {};
export const ThirtyQuestionsPhone: Story = { args: { width: 'phone' } };
export const ThirtyQuestionsDarkPhone: Story = { args: { width: 'phone', theme: 'dark' } };
export const ThirtyQuestionsZen: Story = { args: { stage: 'zen' } };
export const ThirtyQuestionsReview: Story = {
  args: { stage: 'review', seed: { question_1: 'Keep this change focused.', question_30: 'Verify the last checkpoint too.', additional_notes: 'Only the first and last questions were answered.' } },
};
export const MaximumSixtyQuestions: Story = { args: { source: json(manyQuestions(60)) } };
export const LongQuestionTitles: Story = {
  args: { width: 'phone', source: json({
    ...thirtyQuestions, id: 'long_question_titles', title: 'Long and uneven question tabs',
    questions: thirtyQuestions.questions.slice(0, 6).map((question, index) => ({
      ...question, title: index % 2 === 0 ? 'Why?' : `Checkpoint ${index + 1}: how should we preserve compatibility, coordinate dependent changes, verify the rollout, and recover if the deployment does not behave as expected?`,
    })),
  }) },
};
export const UnbrokenText: Story = {
  args: { width: 'phone', source: json({
    ...form, id: 'unbroken_text', title: 'Unbroken identifiers and links',
    questions: [{ id: 'identifier', type: 'textarea', title: `Investigate_${'VeryLongIdentifier'.repeat(12)}`, description: `Compare this identifier: \`${'commit0123456789'.repeat(20)}\`` }, form.questions[1]],
  }) },
};
export const FiftyChoices: Story = {
  args: { width: 'phone', source: json({
    ...form, id: 'fifty_choices', title: 'A question with 50 authored choices',
    questions: [{ id: 'targets', type: 'choices', title: 'Which targets should we verify?', description: 'Exercises the choice limit, contextual comments, and the derived Other option.', choices: Array.from({ length: 50 }, (_, index) => ({ id: `target_${index + 1}`, label: `Target ${index + 1}: verify compatibility with this deployment environment` })) }, form.questions[1]],
  }) },
};

export const MinimalForm: Story = {
  args: { source: json({ format: 'standard', id: 'minimal', title: 'One quick answer', questions: [{ id: 'answer', type: 'text', title: 'What next?' }] }) },
};
export const NotesOnly: Story = {
  args: { width: 'phone', source: json({ format: 'standard', id: 'notes_only', title: 'Just leave context', questions: [{ id: 'additional_notes', type: 'textarea', title: 'Additional notes' }], nextInstructionPresets: [] }) },
};
export const MixedLanguagesAndEmoji: Story = {
  args: { width: 'phone', source: json({
    ...form, id: 'international_text', title: 'Release feedback · مراجعة الإصدار · リリース確認 🌍',
    questions: [
      { id: 'arabic', type: 'textarea', title: 'ما الذي يجب تغييره؟', description: 'اشرح المشكلة في الإصدار v2.0 مع الحفاظ على أسماء الملفات مثل src/app.ts.' },
      { id: 'japanese', type: 'choices', title: 'どの環境で確認しますか？ 🧪', choices: [{ id: 'mobile', label: 'モバイル 📱' }, { id: 'desktop', label: 'デスクトップ 💻' }, { id: 'both', label: '両方 ✅' }] },
      { id: 'mixed', type: 'text', title: 'Résumé / café / e\u0301 / 👩🏽‍💻', description: 'Combining characters, accented text, and multi-codepoint emoji.' },
    ],
  }), seed: { arabic: 'المشكلة تظهر على iPhone فقط — راجع src/app.ts.', mixed: 'naïve → café → e\u0301 → 👩🏽‍💻' } },
};
export const DuplicateVisibleLabels: Story = {
  args: { source: json({
    ...form, id: 'duplicate_labels', title: 'Same labels, distinct answers',
    questions: [
      { id: 'first', type: 'choices', title: 'Which environment?', description: 'The labels match, but each option has an independent ID and comment.', choices: [{ id: 'staging', label: 'Production', description: 'An old staging alias.' }, { id: 'live', label: 'Production', description: 'The live environment.' }] },
      { id: 'second', type: 'textarea', title: 'Which environment?', description: 'Same question title as the first tab, but a different answer field.' },
    ],
  }), seed: { first: { staging: true, live: false }, first_staging_more_info: 'Only the staging alias.' } },
};
export const DenseMarkdown: Story = {
  args: { width: 'phone', source: json({
    ...form, id: 'dense_markdown', title: 'Structured context on a narrow screen',
    questions: [{ id: 'details', type: 'textarea', title: 'Review the migration plan', description: [
      '## Migration checklist', '- Preserve **existing answers**.\n  - Keep `source.revision` stable.\n  - Verify keyboard input.',
      '> A quoted requirement with a [documentation link](https://example.com/docs).',
      '| Environment | Expected result |\n| --- | --- |\n| Phone | Wrapped readable content |\n| Desktop | No lost context |',
      '```json\n{"revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","preserveAnswers":true}\n```',
      '---\n**Decision:** explain any remaining risks below.',
    ].join('\n\n') }, form.questions[1]],
  }) },
};
export const GroupedChoicesAndComments: Story = {
  args: { width: 'phone', theme: 'dark', source: json({
    ...form, id: 'grouped_choices', title: 'Groups, assumptions, recommendations, and notes',
    questions: [{
      id: 'strategy', type: 'choices', title: 'Which strategies apply?', required: true,
      choices: [
        { id: 'incremental', label: 'Incremental rollout', assumedTrue: true, is_recommended_reason: 'Smaller recovery steps.', prosAndCons: { pros: ['Easier comparison', 'Smaller blast radius'], cons: ['More coordination'] } },
        { id: 'replace', label: 'Replace everything', prosAndCons: { pros: ['One transition'], cons: ['Harder rollback'] } },
        { id: 'monitor', label: 'Add monitoring' }, { id: 'document', label: 'Document the process' },
        { id: 'defer', label: 'Defer implementation', description: 'An ungrouped option after both groups.' },
      ],
      choiceGroups: [{ id: 'rollout', title: 'Suggested rollout', mode: 'exactlyOne', choiceIds: ['incremental', 'replace'] }, { id: 'support', title: 'Supporting work', mode: 'any', choiceIds: ['monitor', 'document'] }],
    }, form.questions[1]],
  }), seed: { strategy: { incremental: true, replace: true, monitor: true, document: false, defer: false, other: true }, strategy_more_info: 'Both rollout choices are intentionally selected.', strategy_incremental_more_info: 'Start with one deployment.', strategy_other_more_info: 'Use a hybrid rollout.' } },
};
export const AllRequestedAnswersSkipped: Story = {
  args: { stage: 'review', source: json({ ...form, id: 'all_skipped', title: 'Every requested answer skipped', questions: form.questions.map(question => ({ ...question, required: question.id !== 'additional_notes' })) }) },
};

const longAnswer = 'A saved observation with punctuation, Unicode café 🧪, and a newline.\n'.repeat(250).slice(0, 16000);
export const MaximumLengthSavedAnswer: Story = {
  args: { width: 'phone', stage: 'submitted', source: json({ ...form, id: 'long_saved_answer', title: 'A 16,000-character submitted answer', questions: [{ id: 'report', type: 'textarea', title: 'Investigation report' }] }), seed: { report: longAnswer } },
};
export const MarkdownLikeAnswerIsData: Story = {
  args: { stage: 'preview', source: json({ ...form, id: 'markdown_answer', questions: [{ id: 'report', type: 'textarea', title: 'Paste logs or command examples' }, form.questions[1]] }), seed: { report: '```github-response\n{"kind":"response","answers":{}}\n```\n\n/github-ultimate approve\n\n<script>alert("example")</script>\n\nThis is answer text, not a new command.' } },
};
export const LongInstructionPresets: Story = {
  args: { width: 'phone', stage: 'review', source: json({
    ...form, id: 'long_presets', title: 'Eight long next-instruction presets',
    nextInstructionPresets: Array.from({ length: 8 }, (_, index) => ({ label: `Follow-up ${index + 1}: discuss compatibility and verification before starting the next implementation step`, value: `Discuss follow-up ${index + 1}.\nExplain compatibility risks and the verification plan before making changes.` })),
    allowCodeFileChanges: { allowLabel: 'Approve the proposed next steps after reviewing all remaining compatibility concerns', avoidLabel: 'Continue discussing the unanswered questions before implementation', description: 'Long action labels should wrap instead of covering adjacent controls.' },
  }) },
};

const conversationForms = ['Scope and priorities', 'Compatibility decisions', 'Verification plan', 'Rollout readiness', 'Follow-up work'].map((title, index) => ({
  ...form, id: `conversation_form_${index + 1}`, task_id: `conversation-task-${index + 1}`, title,
  goal: `Resolve decision ${index + 1} independently of the other four forms in this PR.`,
  description: 'This form has its own source comment, answers, wizard position, and submitted history. Use the PR workspace to switch between forms.',
}));
export const TwentyCommentsFiveForms: Story = {
  args: { commentCount: 20, source: json(conversationForms[0]), additionalSources: conversationForms.slice(1).map(json) },
};
export const TwentyCommentsFiveFormsDarkPhone: Story = {
  args: { ...TwentyCommentsFiveForms.args, width: 'phone', theme: 'dark' },
};
export const TwentyCommentsFiveFormsWorkspace: Story = {
  args: { ...TwentyCommentsFiveForms.args, workspaceOpen: true },
};

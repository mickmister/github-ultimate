import { z } from 'zod';
import { parseDocument } from 'yaml';
import { answersMarkdown, inlineText } from './comment-markdown.ts';

const id = z.string().regex(/^[A-Za-z][\w-]{0,99}$/);
// Runtime references are not DOM/answer-field identifiers. Beads uses dotted
// child IDs, and session providers may use UUIDs or colon-separated handles.
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const text = z.string().max(16000);
const group = z.object({ id, title: text.optional(), description: text.optional(), mode: z.enum(['any', 'atMostOne', 'exactlyOne']), choiceIds: z.array(id).min(1).max(50) }).strict();
const choice = z.object({ id, label: text, description: text.optional(), is_recommended_reason: text.optional(), assumedTrue: z.boolean().optional(), prosAndCons: z.object({ pros: z.array(text).max(20).optional(), cons: z.array(text).max(20).optional() }).strict().optional() }).strict();
const base = { id, title: text, description: text.default(''), required: z.boolean().optional() };
const question = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('choices'), choices: z.array(choice).min(1).max(50), choiceGroups: z.array(group).max(20).optional() }).strict(),
  z.object({ ...base, type: z.enum(['text', 'textarea']), placeholder: text.optional() }).strict(),
]);
const formSchema = z.object({
  format: z.literal('standard'), kind: z.literal('form').optional(), version: z.literal(1).default(1),
  id, title: text, goal: text.optional(), description: text.optional(),
  task_id: reference.optional(), session_id: reference.optional(), parent_task_id: reference.optional(),
  invalidatedAt: z.string().max(100).optional(), invalidatedReason: text.optional(),
  allowCodeFileChanges: z.union([z.literal(false), z.object({ allowLabel: text.optional(), avoidLabel: text.optional(), label: text.optional(), description: text.optional(), defaultChecked: z.boolean().optional() }).strict()]).optional(),
  nextInstructionPresets: z.array(z.object({ label: text, value: text }).strict()).max(8).optional(),
  questions: z.array(question).min(1).max(60),
}).strict().superRefine((form, ctx) => {
  const names = new Set(['next_instruction', 'allow_code_file_changes', 'additional_notes_more_info']);
  for (const q of form.questions) {
    const generated = [q.id];
    if (q.id !== 'additional_notes') generated.push(`${q.id}_more_info`);
    if (q.type === 'choices') for (const c of q.choices) generated.push(`${q.id}_${c.id}_more_info`);
    for (const name of generated) {
      if (names.has(name)) ctx.addIssue({ code: 'custom', message: `Duplicate or reserved answer field: ${name}` });
      names.add(name);
    }
    if (q.type !== 'choices') continue;
    const choices = new Set(q.choices.map(c => c.id));
    if (choices.size !== q.choices.length) ctx.addIssue({ code: 'custom', message: `Duplicate choice in ${q.id}` });
    const grouped = new Set<string>();
    const groups = new Set<string>();
    for (const g of q.choiceGroups ?? []) {
      if (groups.has(g.id)) ctx.addIssue({ code: 'custom', message: `Duplicate group: ${g.id}` });
      groups.add(g.id);
      for (const name of g.choiceIds) {
        if (!choices.has(name) || grouped.has(name)) ctx.addIssue({ code: 'custom', message: `Invalid or repeated grouped choice: ${name}` });
        grouped.add(name);
      }
    }
  }
});
export const statuses = ['submitted', 'queued', 'running', 'needs-input', 'ready-for-review', 'failed', 'cancelled', 'done'] as const;
const bead = z.object({ id: reference, title: text, status: z.enum(['open', 'in_progress', 'blocked', 'closed']), dependencies: z.array(reference).max(100).optional() }).strict();
const snapshotSchema = z.object({
  kind: z.literal('workflow'), schema_version: z.literal(1), task_id: reference,
  title: text, status: z.enum(statuses), session_id: reference.optional(), attempt_id: reference.optional(),
  updated_at: z.iso.datetime({ offset: true }), started_at: z.iso.datetime({ offset: true }).optional(),
  run_url: z.string().max(2000).optional(), dashboard_url: z.string().max(2000).optional(),
  dashboard_status: z.enum(['available', 'offline']).optional(),
  formula: text.optional(), gascity_version: text.optional(), head_sha: z.string().regex(/^[a-f0-9]{7,64}$/i).optional(),
  summary: text.optional(), beads: z.array(bead).max(300).default([]),
}).strict();
export type TaskForm = z.infer<typeof formSchema>;
export type Question = TaskForm['questions'][number];
export type Snapshot = z.infer<typeof snapshotSchema>;
const sourceSchema = z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), number: z.number().int().positive(), comment_id: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const responseSchema = z.object({
  kind: z.literal('response'), schema_version: z.literal(1), response_id: reference,
  task_id: reference, form_id: id, session_id: reference.nullable(), parent_task_id: reference.nullable(),
  source: sourceSchema, intent: z.enum(['discussion', 'approved-next-steps']),
  resume_session: z.boolean(), allow_code_file_changes: z.boolean(),
  omitted_questions: z.array(id).max(60).optional(),
  answers: z.record(z.string().max(250), z.union([text, z.boolean(), z.record(id, z.boolean())])).refine(value => Object.keys(value).length <= 400, 'Too many answer fields'),
}).strict().refine(value => value.allow_code_file_changes === (value.intent === 'approved-next-steps'), 'Response intent and permission must agree');
export type ResponseRecord = z.infer<typeof responseSchema>;
export type RecordData = TaskForm | Snapshot | ResponseRecord;
export type Answers = Record<string, string | boolean | Record<string, boolean>>;

export function parseRecord(raw: string): RecordData {
  if (raw.length > 100000) throw new Error('Record exceeds 100 KB.');
  let body = raw.trim();
  let instructions = '';
  if (body.startsWith('---\n') || body.startsWith('---\r\n')) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/.exec(body);
    if (!match) throw new Error('Unclosed YAML frontmatter.');
    body = match[1]; instructions = match[2]?.trim() ?? '';
  }
  const doc = parseDocument(body, { uniqueKeys: true, strict: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  // Reject deeply nested input before schema traversal and prohibit alias expansion above.
  function depth(v: unknown, n = 0): void {
    if (n > 16) throw new Error('Record nesting exceeds 16 levels.');
    if (v && typeof v === 'object') for (const item of Object.values(v)) depth(item, n + 1);
  }
  depth(value);
  const record = z.union([formSchema, snapshotSchema, responseSchema]).parse(value);
  if ('format' in record && instructions) record.description = [record.description, instructions].filter(Boolean).join('\n\n');
  return record;
}

export function omittedQuestions(form: TaskForm, answers: Answers): string[] {
  return form.questions.filter(q => {
    const value = answers[q.id];
    if (q.type !== 'choices') return q.required && (typeof value !== 'string' || !value.trim());
    const selected = value && typeof value === 'object' ? value : {};
    return (q.required && !Object.values(selected).some(Boolean)) || q.choiceGroups?.some(g => g.mode === 'exactlyOne' && !g.choiceIds.some(id => selected[id]));
  }).map(q => q.id);
}

export function validateAnswers(form: TaskForm, answers: Answers, options: { allowUnanswered?: boolean } = {}): string[] {
  const errors: string[] = [];
  const allowed = new Set(['additional_notes', 'next_instruction']);
  for (const q of form.questions) {
    allowed.add(q.id);
    if (q.id !== 'additional_notes') allowed.add(`${q.id}_more_info`);
    if (q.type === 'choices') for (const c of q.choices) allowed.add(`${q.id}_${c.id}_more_info`);
  }
  for (const [name, value] of Object.entries(answers)) {
    if (!allowed.has(name)) errors.push(`Unknown answer field: ${name}.`);
    const q = form.questions.find(q => q.id === name);
    if (q?.type !== 'choices' && (typeof value !== 'string' || value.length > (name === 'next_instruction' ? 8000 : 16000))) errors.push(`Invalid text answer: ${name}.`);
  }
  for (const q of form.questions) {
    const value = answers[q.id];
    if (q.type !== 'choices') {
      if (!options.allowUnanswered && q.required && (typeof value !== 'string' || !value.trim())) errors.push(`${q.title}: enter an answer.`);
      continue;
    }
    const selected = value && typeof value === 'object' ? value : {};
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(selected).some(([name, selected]) => !q.choices.some(c => c.id === name) || typeof selected !== 'boolean'))) errors.push(`${q.title}: invalid choice answer.`);
    if (!options.allowUnanswered && q.required && !Object.values(selected).some(Boolean)) errors.push(`${q.title}: select an option.`);
    for (const g of q.choiceGroups ?? []) {
      const count = g.choiceIds.filter(name => selected[name]).length;
      if ((g.mode === 'exactlyOne' && (count > 1 || (!options.allowUnanswered && count !== 1))) || (g.mode === 'atMostOne' && count > 1)) errors.push(`${g.title ?? q.title}: ${g.mode === 'exactlyOne' ? 'select exactly one' : 'select at most one'}.`);
    }
  }
  return errors;
}

export async function revisionOf(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function composeResponse(form: TaskForm, answers: Answers, source: { repository: string; number: number; comment_id: string; revision: string }, approved: boolean, options: { allowUnanswered?: boolean } = {}): string {
  const errors = validateAnswers(form, answers, options);
  if (errors.length) throw new Error(errors.join('\n'));
  const allow = form.allowCodeFileChanges === false ? false : approved;
  const payload = {
    schema_version: 1, kind: 'response', response_id: `response-${crypto.randomUUID()}`,
    task_id: form.task_id ?? form.id, form_id: form.id, session_id: form.session_id ?? null,
    parent_task_id: form.parent_task_id ?? null, source,
    intent: allow ? 'approved-next-steps' : 'discussion', resume_session: Boolean(form.session_id),
    allow_code_file_changes: allow, answers,
    ...(omittedQuestions(form, answers).length ? { omitted_questions: omittedQuestions(form, answers) } : {}),
  };
  const title = inlineText(form.title);
  const comment = `/github-ultimate ${allow ? 'approve' : 'discuss'}\n\n${allow ? 'Approved for next steps' : 'Continue discussion — do not implement yet'}: ${title}\n\n<details>\n<summary>Submitted answers · GitHub Ultimate</summary>\n\n${answersMarkdown(form, answers)}\n### Structured response\n\n\`\`\`github-response\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n</details>`;
  if (comment.length > 65000) throw new Error('Response is too large for a GitHub comment. Shorten your answers or notes.');
  return comment;
}

export function safeLink(value: string | undefined, type: 'run' | 'dashboard', repository: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return;
    if (type === 'run' && url.hostname === 'github.com' && url.pathname.startsWith(`/${repository}/actions/runs/`) && /^\d+(?:\/attempts\/\d+)?\/?$/.test(url.pathname.split('/actions/runs/')[1])) return url.href;
    if (type === 'dashboard' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(url.hostname)) return url.href;
  } catch { /* Untrusted URLs are displayed only as unavailable. */ }
}

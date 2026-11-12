import { z } from 'zod';
import { parseRecord, validateAnswers } from './protocol.ts';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
const bead = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
export const reviewOid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const resource = z.string().min(1).max(1000).refine(value => !/[\\\x00-\x1f%]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'), 'Expected a relative document path');
export const reviewPinSchema = z.object({ resource, version_kind: z.literal('git-blob'), version: reviewOid, snapshot: reviewOid }).strict();
const member = { id: key, label: z.string().min(1).max(1000) };
export const reviewMemberSchema = z.discriminatedUnion('kind', [
  z.object({ ...member, kind: z.literal('document'), target: reviewPinSchema, baseline: reviewPinSchema.optional() }).strict(),
  z.object({ ...member, kind: z.literal('form'), bead_id: bead, form_id: key, dsl: reviewPinSchema }).strict(),
]);
export const reviewRequestSchema = z.object({
  kind: z.literal('review-request'), schema_version: z.literal(1), request_id: key, revision_id: key,
  workspace: key, bead_id: bead, related_beads: z.array(bead).max(100).default([]),
  thread: resource, title: z.string().min(1).max(1000), purpose: z.string().min(1).max(16000),
  question: z.string().min(1).max(16000), status: z.enum(['draft', 'published', 'withdrawn']),
  change_kind: z.enum(['proposal', 'implemented', 'mixed']), previous_request: key.optional(),
  members: z.array(reviewMemberSchema).min(1).max(64),
}).strict().superRefine((value, ctx) => {
  if (value.thread !== `threads/${value.bead_id}` && !value.thread.startsWith(`threads/${value.bead_id}/`)) ctx.addIssue({ code: 'custom', message: 'Thread must belong to the owning Bead' });
  if (new Set(value.members.map(member => member.id)).size !== value.members.length) ctx.addIssue({ code: 'custom', message: 'Duplicate member ID' });
});
const answers = z.record(z.string().max(250), z.union([z.string().max(16000), z.boolean(), z.record(z.string().max(100), z.boolean())])).refine(value => Object.keys(value).length <= 400);
const formAnswer = z.object({
  member_id: key, bead_id: bead, form_id: key, dsl: reviewPinSchema, answers,
  intent: z.enum(['discussion', 'approved-next-steps']),
}).strict();
const artifact = {
  schema_version: z.literal(1), transport: z.literal('workspace-resources'), id: key,
  request: z.object({ id: key, version: reviewOid, snapshot: reviewOid }).strict(),
  reviewer: z.string().regex(/^github:[1-9][0-9]*$/),
  forms: z.array(formAnswer).max(64),
  comments: z.array(z.object({ id: key, version: z.number().int().positive().optional(), member_id: key, text: z.string().min(1).max(16000), quote: z.string().max(16000).optional(),
    kind: z.enum(['content-comment', 'feature-comment']).optional(), captured_at: z.string().max(100).optional(), app_build: z.string().max(200).optional(),
    selection: z.object({ text: z.string().max(16000), representation: z.string().max(100), prefix: z.string().max(1000).optional(), suffix: z.string().max(1000).optional(), textRange: z.object({ startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative() }).strict().optional(), ranges: z.array(z.object({ startLineNumber: z.number().int().positive(), startColumn: z.number().int().positive(), endLineNumber: z.number().int().positive(), endColumn: z.number().int().positive() }).strict()).max(100).optional() }).strict().nullable().optional(),
  }).strict()).max(200),
  progress: z.array(key).max(64),
};
export const reviewArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ ...artifact, kind: z.literal('review-response'), intent: z.enum(['feedback', 'acknowledgement']) }).strict(),
  z.object({ ...artifact, kind: z.literal('review-draft') }).strict(),
]);
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export type ReviewMember = z.infer<typeof reviewMemberSchema>;
export type ReviewPin = z.infer<typeof reviewPinSchema>;
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;
export interface ReviewReceipt { resource: string; version: string; snapshot: string; reviewer: string }
export const reviewWriteSchema = z.object({
  operation: z.literal('reviewWrite'), id: z.string().uuid(), installationId: z.number().int().positive(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: key,
  text: z.string().max(256000), expected: reviewOid.nullable(),
}).strict();
export type ReviewWrite = z.infer<typeof reviewWriteSchema>;
export function parseReviewRequest(text: string) {
  if (new TextEncoder().encode(text).length > 256000) throw new Error('Review request exceeds 256 KB.');
  return reviewRequestSchema.parse(JSON.parse(text));
}
export function parseReviewArtifact(text: string) {
  if (new TextEncoder().encode(text).length > 256000) throw new Error('Review artifact exceeds 256 KB.');
  return reviewArtifactSchema.parse(JSON.parse(text));
}
export const requestResource = (id: string) => `review-requests/${key.parse(id)}/request.json`;
export function artifactResource(value: ReviewArtifact) {
  const root = `review-requests/${value.request.id}`;
  return value.kind === 'review-response' ? `${root}/responses/${value.id}.json`
    : `${root}/drafts/${value.reviewer.slice(7)}/${value.request.version}.json`;
}
export function samePin(a: ReviewPin, b: ReviewPin) {
  return a.resource === b.resource && a.version_kind === b.version_kind && a.version === b.version && a.snapshot === b.snapshot;
}
export async function validateReviewArtifact(request: ReviewRequest, value: ReviewArtifact, read: (pin: ReviewPin) => Promise<string>) {
  if (value.request.id !== request.request_id || request.status !== 'published') throw new Error('Responses require the matching published request revision.');
  for (const field of [value.forms.map(form => form.member_id), value.progress, value.comments.map(comment => comment.id)]) {
    if (new Set(field).size !== field.length) throw new Error('Duplicate review item identity.');
  }
  for (const id of [...value.progress, ...value.comments.map(comment => comment.member_id)]) {
    if (!request.members.some(member => member.id === id)) throw new Error('Review item refers to a different request.');
  }
  for (const answer of value.forms) {
    const member = request.members.find(member => member.id === answer.member_id);
    if (member?.kind !== 'form' || member.bead_id !== answer.bead_id || member.form_id !== answer.form_id || !samePin(member.dsl, answer.dsl)) throw new Error('Form answer does not match the pinned form identity.');
    const form = parseRecord(await read(member.dsl));
    if (!('format' in form) || form.id !== member.form_id || form.task_id && form.task_id !== member.bead_id) throw new Error('Pinned DSL does not match its declared form/Bead.');
    if (form.invalidatedAt || form.allowCodeFileChanges === false && answer.intent === 'approved-next-steps') throw new Error('This form cannot authorize code changes.');
    const errors = validateAnswers(form, answer.answers, { allowUnanswered: value.kind === 'review-draft' });
    if (errors.length) throw new Error(errors.join('\n'));
  }
}

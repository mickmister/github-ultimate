import { z } from 'zod';

const text = z.string().min(1);
const uuid = z.string().uuid();
const body = text.max(65536).refine(value => value.trim().length > 0 && new TextEncoder().encode(value).length <= 65536, 'Expected nonblank text within 64 KiB UTF-8.');
const oid = z.string().regex(/^[0-9a-f]{40}$/);
export const workspaceBindingSchema = z.object({
  workspaceRef: z.string().regex(/^ws-[0-9a-f]{32}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), namespace: text,
}).strict();
export type WorkspaceBinding = z.infer<typeof workspaceBindingSchema>;
const resourceFields = { kind: z.enum(['document', 'image']), id: text, repository: text.optional(), workspace: text.optional(), path: text.optional() };
export const resourceSchema = z.discriminatedUnion('revisionKind', [
  z.object({ ...resourceFields, revisionKind: z.literal('git-commit'), revision: oid }).strict(),
  z.object({ ...resourceFields, revisionKind: z.literal('git-blob'), revision: oid }).strict(),
  z.object({ ...resourceFields, revisionKind: z.literal('sha256'), revision: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
]);
export type InteractionResource = z.infer<typeof resourceSchema>;
const rangeSchema = z.object({ startLineNumber: z.number().int().positive(), startColumn: z.number().int().positive(), endLineNumber: z.number().int().positive(), endColumn: z.number().int().positive() }).strict();
const selectionSchema = z.object({ text: z.string(), representation: text, prefix: z.string().optional(), suffix: z.string().optional(), textRange: z.object({ startOffset: z.number().int().nonnegative().safe(), endOffset: z.number().int().nonnegative().safe() }).strict().optional(), ranges: z.array(rangeSchema).min(1).optional() }).strict().nullable();
const targetFields = { elementId: text, label: text, uiPath: z.array(text).min(1), featureId: text, representation: text.optional() };
const contextFields = { selection: selectionSchema, pageUrl: z.string().url().optional(), appBuild: text, capturedAt: z.string().datetime({ offset: true }) };
const contextSchema = z.object({ ...contextFields, target: z.object({ ...targetFields, resource: resourceSchema.optional() }).strict() }).strict();
const legacyResourceSchema = z.object({ kind: text, id: text, repository: text.optional(), workspace: text.optional(), path: text.optional(), revision: text.optional() }).strict();
const legacyCommentSchema = z.object({
  id: uuid, version: z.number().int().positive().safe(), kind: z.enum(['content-comment', 'feature-comment']), comment: body,
  context: z.object({ ...contextFields, target: z.object({ ...targetFields, resource: legacyResourceSchema.optional() }).strict() }).strict(),
}).strict();
export type LegacyResource = z.infer<typeof legacyResourceSchema>;
export const legacyBatchSchema = z.object({ schemaVersion: z.literal(1), batchId: uuid, exportedAt: z.string().datetime({ offset: true }), interactions: z.array(legacyCommentSchema).min(1).max(100) }).strict();
const issueVersion = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const operationBase = { operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/), issueId: text.max(255) };
const operationSchema = z.union([
  z.object({ ...operationBase, type: z.enum(['label.add', 'label.remove']), label: text.max(255).refine(value => !!value.trim()), precondition: z.object({ labelPresent: z.boolean(), issueVersion: issueVersion.optional() }).strict() }).strict(),
  z.object({ ...operationBase, type: z.literal('comment.add'), body, precondition: z.object({ issueExists: z.literal(true), issueVersion: issueVersion.optional() }).strict() }).strict(),
]);
export const changesetSchema = z.object({
  schema: z.literal('beads.changeset/v1'), changesetId: uuid,
  workspaceRef: workspaceBindingSchema.shape.workspaceRef, collectionId: uuid,
  observedDoltCommit: z.string().regex(/^[0-9a-v]{32}$/), operations: z.array(operationSchema).min(1).max(100),
}).strict();
export type BeadsChangeset = z.infer<typeof changesetSchema>;
const selectorSchema = z.discriminatedUnion('type', [
  z.object({ id: text, type: z.literal('text-quote'), representation: text, quote: text, prefix: z.string().optional(), suffix: z.string().optional() }).strict(),
  z.object({ id: text, type: z.literal('image-region'), imageWidth: z.number().int().positive(), imageHeight: z.number().int().positive(), x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict(),
  z.object({ id: text, type: z.literal('editor-elements'), elementIds: z.array(text).min(1) }).strict(),
]);
const itemBase = { id: uuid, version: z.number().int().positive().safe() };
const itemSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemBase, kind: z.literal('content-comment'), comment: body, context: contextSchema }).strict(),
  z.object({ ...itemBase, kind: z.literal('feature-comment'), comment: body, context: contextSchema }).strict(),
  z.object({ ...itemBase, kind: z.literal('annotation'), context: contextSchema,
    payload: z.object({ schema: text, value: z.record(z.string(), z.json()) }).strict(),
    selectors: z.array(selectorSchema).min(1), comments: z.array(z.object({ id: uuid, body, selectorIds: z.array(text).min(1) }).strict()).min(1),
  }).strict(),
  z.object({ ...itemBase, kind: z.literal('beads-changeset'), changeset: changesetSchema }).strict(),
]);
export const interactionBatchSchema = z.object({ schemaVersion: z.literal(2), batchId: uuid, exportedAt: z.string().datetime({ offset: true }), workspace: workspaceBindingSchema, interactions: z.array(itemSchema).min(1).max(100) }).strict();
export type InteractionBatch = z.infer<typeof interactionBatchSchema>;
export type InteractionItem = InteractionBatch['interactions'][number];
export type AnnotationItem = Extract<InteractionItem, { kind: 'annotation' }>;

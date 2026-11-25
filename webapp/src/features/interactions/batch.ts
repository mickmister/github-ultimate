import { interactionBatchSchema, legacyBatchSchema, type InteractionBatch, type InteractionResource, type LegacyResource, type WorkspaceBinding } from './schema';

export class InteractionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export interface BatchBinding extends WorkspaceBinding {
  readonly collectionId?: string;
  /** Independently selected, verified native head used for preview, not client provenance. */
  readonly doltCommit?: string;
}
export interface LegacyAdapter {
  /** Resolve the producer's revision semantics explicitly; never infer commit vs blob from length. */
  resource(resource: LegacyResource): InteractionResource;
}

function checkUnicode(value: unknown): void {
  if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new InteractionError('invalid-unicode', 'Intent contains an unpaired Unicode surrogate.');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { checkUnicode(key); checkUnicode(child); }
}
function unique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) throw new InteractionError(code, 'Duplicate identifiers or targets in this batch.');
}
export function validateBatch(input: unknown, binding: BatchBinding): InteractionBatch {
  const parsed = interactionBatchSchema.safeParse(input);
  if (!parsed.success) throw new InteractionError('invalid-schema', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const batch = parsed.data;
  checkUnicode(batch);
  if (new TextEncoder().encode(JSON.stringify(batch)).length > 1024 * 1024) throw new InteractionError('byte-limit', 'Batch exceeds 1 MiB UTF-8.');
  for (const key of ['workspaceRef', 'repository', 'namespace'] as const) if (batch.workspace[key] !== binding[key]) throw new InteractionError('workspace-binding', 'Batch does not match the selected workspace.');
  unique(batch.interactions.map(item => item.id), 'duplicate-item');
  const native = batch.interactions.filter(item => item.kind === 'beads-changeset');
  if (native.length > 1) throw new InteractionError('multiple-native-groups', 'Compose native operations into one changeset before freezing.');
  const commentIds: string[] = [];
  for (const item of batch.interactions) {
    if (item.kind === 'beads-changeset') {
      const request = item.changeset;
      if (!binding.collectionId || request.collectionId !== binding.collectionId || request.workspaceRef !== binding.workspaceRef) throw new InteractionError('collection-binding', 'Native changeset does not match the selected collection.');
      unique(request.operations.map(operation => operation.operationId), 'duplicate-operation');
      unique(request.operations.filter(operation => operation.type !== 'comment.add').map(operation => JSON.stringify([operation.issueId, operation.label])), 'repeated-label');
      const versions = new Map<string, string>();
      for (const operation of request.operations) {
        const version = operation.precondition.issueVersion;
        if (!version) continue;
        if (versions.has(operation.issueId) && versions.get(operation.issueId) !== version) throw new InteractionError('inconsistent-version', 'Conflicting issue versions for one target.');
        versions.set(operation.issueId, version);
      }
      continue;
    }
    if (item.kind !== 'feature-comment' && !item.context.target.resource) throw new InteractionError('missing-resource', 'Content feedback requires a pinned resource.');
    const selection = item.context.selection;
    if (selection?.textRange && (selection.representation === 'source' || selection.textRange.endOffset <= selection.textRange.startOffset)) throw new InteractionError('rendered-range', 'Rendered text ranges must be ordered and cannot be source model positions.');
    if (selection?.ranges) {
      if (selection.representation !== 'source') throw new InteractionError('range-representation', 'Source model ranges cannot be rendered-text offsets.');
      for (const range of selection.ranges) if (range.endLineNumber < range.startLineNumber || range.endLineNumber === range.startLineNumber && range.endColumn < range.startColumn) throw new InteractionError('reversed-range', 'Source selection ends before it starts.');
    }
    if (item.kind !== 'annotation') continue;
    unique(item.selectors.map(selector => selector.id), 'duplicate-selector');
    const selectors = new Set(item.selectors.map(selector => selector.id));
    for (const comment of item.comments) {
      commentIds.push(comment.id);
      unique(comment.selectorIds, 'duplicate-comment-selector');
      if (comment.selectorIds.some(id => !selectors.has(id))) throw new InteractionError('missing-selector', 'Annotation comment references a missing selector.');
    }
    for (const selector of item.selectors) {
      if (selector.type === 'editor-elements') unique(selector.elementIds, 'duplicate-element');
      if (selector.type === 'image-region' && (item.context.target.resource?.kind !== 'image' || selector.x + selector.width > selector.imageWidth || selector.y + selector.height > selector.imageHeight)) throw new InteractionError('image-bounds', 'Image region does not fit its declared target.');
    }
  }
  unique(commentIds, 'duplicate-comment');
  return batch;
}

/** Strict, all-items-or-error import. No queue mutation, hidden ID generation, or approval. */
export function importBatch(json: string, binding: BatchBinding, legacy?: LegacyAdapter): InteractionBatch {
  if (new TextEncoder().encode(json).length > 1024 * 1024) throw new InteractionError('byte-limit', 'Batch exceeds 1 MiB UTF-8.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new InteractionError('invalid-json', 'Expected a JSON export.'); }
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1) {
    if (!legacy) throw new InteractionError('legacy-adapter-required', 'Select an explicit producer adapter for this v1 export.');
    const parsed = legacyBatchSchema.safeParse(value);
    if (!parsed.success) throw new InteractionError('invalid-legacy', 'Malformed or unsupported v1 export; all original items are retained by the caller.');
    const original = parsed.data;
    value = { ...original, schemaVersion: 2, workspace: { workspaceRef: binding.workspaceRef, repository: binding.repository, namespace: binding.namespace }, interactions: original.interactions.map(item => ({
      ...item, context: { ...item.context, target: { ...item.context.target, ...(item.context.target.resource ? { resource: legacy.resource(item.context.target.resource) } : {}) } },
    })) };
  }
  return validateBatch(value, binding);
}

/** Adapter for the current Documents producer, whose revision is a snapshot commit. */
export function documentsV1Adapter(binding: BatchBinding): LegacyAdapter {
  return { resource(resource) {
    if (resource.repository !== binding.repository || resource.workspace !== binding.namespace || !resource.path || !resource.revision || !['document', 'image'].includes(resource.kind)) throw new InteractionError('legacy-resource', 'Legacy resource needs an explicit matching Documents scope/path/revision.');
    return { ...resource, kind: resource.kind as 'document' | 'image', revision: resource.revision, revisionKind: 'git-commit' };
  } };
}

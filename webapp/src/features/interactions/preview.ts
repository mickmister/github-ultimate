import { InteractionError, validateBatch, type BatchBinding } from './batch';
import type { AnnotationItem, InteractionBatch, InteractionItem } from './schema';
import type { ResolvedResource, ResourceResolver } from './resources';

export type PreviewStatus = 'ready' | 'conflict' | 'unsupported' | 'unavailable';
export interface PreviewIssue { readonly code: string; readonly message: string }
export interface ItemPreview {
  readonly item: InteractionItem;
  readonly effectId: string;
  readonly itemDigest: string;
  readonly group: 'documents' | 'native-beads';
  readonly status: PreviewStatus;
  readonly issues: readonly PreviewIssue[];
  readonly target: unknown;
  readonly resource?: { readonly blobOid: string; readonly path: string; readonly snapshotCommit: string };
  readonly anchors: readonly { readonly id: string; readonly status: 'exact' | 'ambiguous' | 'orphaned'; readonly ranges?: readonly { startUtf8: number; endUtf8: number }[] }[];
}
export interface NativeSnapshot {
  readonly workspaceRef: string;
  readonly collectionId: string;
  readonly doltCommit: string;
  readonly issues: readonly { readonly issueId: string; readonly exists: boolean; readonly issueVersion?: string; readonly labels: readonly string[] }[];
}
export interface PreviewServices {
  readonly resolve: ResourceResolver;
  /** Read-only native storage adapter, never snapshot data supplied by the packet. */
  readonly native?: (request: { readonly workspaceRef: string; readonly collectionId: string; readonly doltCommit: string; readonly issueIds: readonly string[] }, signal?: AbortSignal) => Promise<NativeSnapshot>;
  /** Return true only for an exact feature/build known by the host application. */
  readonly feature?: (featureId: string, appBuild: string) => boolean;
  /** Renderer-specific text for this exact resource/build. No source-offset guessing. */
  readonly representation?: (resource: ResolvedResource, representation: string, appBuild: string) => string | undefined;
  /** Trusted in-process validators for editor-native payloads. Unknown formats remain visible. */
  readonly annotations?: ReadonlyMap<string, (item: AnnotationItem, resource: ResolvedResource) => { readonly elementIds: readonly string[] }>;
}

// RFC 8785 serialization for parsed JSON: UTF-16 key sorting, ECMAScript primitive
// serialization, and rejection of non-JSON Unicode/numbers at the validation boundary.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function itemDigest(workspace: InteractionBatch['workspace'], item: InteractionItem) {
  const bytes = new TextEncoder().encode(canonical({ workspace, item }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function quoteRanges(text: string, quote: string, prefix = '', suffix = '') {
  if (!quote) return [];
  const ranges = [];
  let at = text.indexOf(quote);
  while (at >= 0) {
    const end = at + quote.length;
    if (text.slice(Math.max(0, at - prefix.length), at) === prefix && text.slice(end, end + suffix.length) === suffix) ranges.push({ start: at, end });
    if (ranges.length === 2) break; // Two valid matches already establish ambiguity.
    at = text.indexOf(quote, at + 1);
  }
  return ranges;
}
function sourceOffsets(text: string, ranges: readonly { startLineNumber: number; endLineNumber: number }[]) {
  const requested = new Set(ranges.flatMap(range => [range.startLineNumber, range.endLineNumber]));
  const lines = new Map<number, { start: number; end: number }>();
  const last = Math.max(...requested), breaks = /\r\n|\r|\n/g;
  let line = 1, start = 0, match: RegExpExecArray | null;
  // Scan once and retain only selected lines, not every newline in a large blob.
  while (line <= last && (match = breaks.exec(text))) {
    if (requested.has(line)) lines.set(line, { start, end: match.index });
    start = match.index + match[0].length; line++;
  }
  if (line <= last && requested.has(line)) lines.set(line, { start, end: text.length });
  return (number: number, column: number) => {
    const bounds = lines.get(number);
    if (!bounds || column - 1 > bounds.end - bounds.start) throw new InteractionError('stale-range', 'Selection lies outside the pinned source.');
    const at = bounds.start + column - 1;
    if (at > 0 && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at] ?? '')) throw new InteractionError('split-codepoint', 'Selection splits a Unicode code point.');
    return at;
  };
}

/** Read-only deterministic projection; status=ready is never acceptance or publication. */
export async function previewBatch(input: unknown, binding: BatchBinding, services: PreviewServices, signal?: AbortSignal) {
  const batch = validateBatch(input, binding);
  const rows: ItemPreview[] = [];
  for (const item of batch.interactions) {
    signal?.throwIfAborted();
    const issues: PreviewIssue[] = [], anchors: ItemPreview['anchors'][number][] = [];
    let status: PreviewStatus = 'ready';
    let resource: ItemPreview['resource'];
    const fail = (next: PreviewStatus, code: string, message: string) => { if (status === 'ready') status = next; issues.push({ code, message }); };
    const target = item.kind === 'beads-changeset' ? { collectionId: item.changeset.collectionId, observedDoltCommit: item.changeset.observedDoltCommit, previewDoltCommit: binding.doltCommit, operations: item.changeset.operations }
      : item.kind === 'feature-comment' ? { kind: 'feature', featureId: item.context.target.featureId, appBuild: item.context.appBuild }
        : item.context.target.resource;
    try {
      if (item.kind === 'beads-changeset') {
        if (!services.native || !binding.doltCommit) fail('unsupported', 'native-reader-unavailable', 'A verified native head and read-only snapshot reader are required.');
        else {
          const snapshot = await services.native({ workspaceRef: binding.workspaceRef, collectionId: item.changeset.collectionId, doltCommit: binding.doltCommit, issueIds: [...new Set(item.changeset.operations.map(operation => operation.issueId))] }, signal);
          if (snapshot.workspaceRef !== binding.workspaceRef || snapshot.collectionId !== binding.collectionId || snapshot.doltCommit !== binding.doltCommit) throw new InteractionError('native-snapshot-binding', 'Native reader did not return the requested workspace/collection/revision.');
          const byId = new Map(snapshot.issues.map(issue => [issue.issueId, issue]));
          if (byId.size !== snapshot.issues.length) throw new InteractionError('native-snapshot-binding', 'Native reader returned duplicate issue identities.');
          for (const operation of item.changeset.operations) {
            const issue = byId.get(operation.issueId);
            if (!issue) fail('unavailable', 'missing-native-result', `Reader omitted ${operation.issueId}.`);
            else if (!issue.exists) fail('conflict', 'missing-issue', `${operation.issueId} no longer exists in this snapshot.`);
            else if (operation.precondition.issueVersion && !issue.issueVersion) fail('unsupported', 'issue-version-unavailable', 'Strict issue version derivation is unavailable.');
            else if (operation.precondition.issueVersion && operation.precondition.issueVersion !== issue.issueVersion) fail('conflict', 'issue-version', 'Strict issue version differs.');
            else if (operation.type !== 'comment.add' && issue.labels.includes(operation.label) !== operation.precondition.labelPresent) fail('conflict', 'label-membership', `Membership changed for ${operation.label}.`);
          }
        }
      } else {
        if (item.kind === 'feature-comment' && !services.feature?.(item.context.target.featureId, item.context.appBuild)) fail('unsupported', 'unknown-feature-build', 'Feature/build is not recognized by the host.');
        const reference = item.context.target.resource;
        if (reference) {
          const resolved = await services.resolve(reference, signal);
          // Resolver implementations are trusted capabilities, but must bind their result.
          if (canonical(resolved.reference) !== canonical(reference)) throw new InteractionError('resource-binding', 'Resolver returned a different resource reference.');
          resource = { blobOid: resolved.blobOid, path: resolved.path, snapshotCommit: resolved.snapshotCommit };
          const anchor = (id: string, representation: string, quote: string, prefix?: string, suffix?: string) => {
            const text = representation === 'source' ? resolved.text : services.representation?.(resolved, representation, item.context.appBuild);
            if (text === undefined) { fail('unsupported', 'representation-unavailable', `No exact ${representation} adapter for this build.`); return; }
            const ranges = quoteRanges(text, quote, prefix, suffix);
            const state = ranges.length === 1 ? 'exact' : ranges.length ? 'ambiguous' : 'orphaned';
            // Only source positions are converted to stored-source UTF-8 byte offsets.
            anchors.push({ id, status: state, ...(representation === 'source' && state === 'exact' ? { ranges: ranges.map(range => ({ startUtf8: new TextEncoder().encode(text.slice(0, range.start)).length, endUtf8: new TextEncoder().encode(text.slice(0, range.end)).length })) } : {}) });
            if (state !== 'exact') fail('conflict', state, `Anchor ${id} is ${state} in the exact pinned representation.`);
          };
          // Feature selections are reproduction context, not resource-edit anchors.
          if (item.kind === 'content-comment' && item.context.selection) {
            const selection = item.context.selection;
            if (selection.ranges) {
              if (resolved.text === undefined) throw new InteractionError('source-unavailable', 'Pinned source text is unavailable.');
              const text = resolved.text;
              const offset = sourceOffsets(text, selection.ranges);
              const ranges = selection.ranges.map(range => ({ start: offset(range.startLineNumber, range.startColumn), end: offset(range.endLineNumber, range.endColumn) }));
              if (ranges.map(range => text.slice(range.start, range.end).replace(/\r\n|\r/g, '\n')).join('\n') !== selection.text.replace(/\r\n|\r/g, '\n')) fail('conflict', 'stale-range', 'Source ranges no longer match the captured quote.');
              else anchors.push({ id: 'selection', status: 'exact', ranges: ranges.map(range => ({ startUtf8: new TextEncoder().encode(text.slice(0, range.start)).length, endUtf8: new TextEncoder().encode(text.slice(0, range.end)).length })) });
            } else anchor('selection', selection.representation, selection.text, selection.prefix, selection.suffix);
          }
          if (item.kind === 'annotation') {
            const adapter = services.annotations?.get(item.payload.schema);
            const native = adapter?.(item, resolved);
            if (!native) fail('unsupported', 'annotation-format', `Unsupported native payload ${item.payload.schema}; original payload retained.`);
            for (const selector of item.selectors) {
              if (selector.type === 'text-quote') anchor(selector.id, selector.representation, selector.quote, selector.prefix, selector.suffix);
              if (selector.type === 'image-region') {
                if (!resolved.dimensions || resolved.dimensions.width !== selector.imageWidth || resolved.dimensions.height !== selector.imageHeight) fail('conflict', 'image-dimensions', 'Region dimensions differ from the verified image.');
                else anchors.push({ id: selector.id, status: 'exact' });
              }
              if (selector.type === 'editor-elements' && native) {
                if (selector.elementIds.some(id => !native.elementIds.includes(id))) fail('conflict', 'missing-element', 'Annotation references missing native editor elements.');
                else anchors.push({ id: selector.id, status: 'exact' });
              }
            }
          }
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      const code = error instanceof InteractionError ? error.code : 'resource-unavailable';
      fail(code.startsWith('unsupported') ? 'unsupported' : ['stale-range', 'split-codepoint'].includes(code) ? 'conflict' : 'unavailable', code, error instanceof Error ? error.message : 'Preview could not resolve its input.');
    }
    signal?.throwIfAborted();
    rows.push({ item, effectId: `item/${item.id}`, itemDigest: await itemDigest(batch.workspace, item), group: item.kind === 'beads-changeset' ? 'native-beads' : 'documents', status, issues, target, ...(resource ? { resource } : {}), anchors });
  }
  signal?.throwIfAborted();
  return { schema: 'workspace.interaction-preview/v1' as const, batchId: batch.batchId, ready: rows.every(row => row.status === 'ready'), rows,
    groups: (['documents', 'native-beads'] as const).filter(group => rows.some(row => row.group === group)).map(group => ({ group, atomicBoundary: group === 'documents' ? 'one-ref-commit' : 'native-transaction-and-commit', ready: rows.filter(row => row.group === group).every(row => row.status === 'ready'), effectIds: rows.filter(row => row.group === group).map(row => row.effectId) })),
  };
}
export type InteractionPreview = Awaited<ReturnType<typeof previewBatch>>;

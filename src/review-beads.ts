import { parseRecord, revisionOf } from './protocol.ts';
import type { ReviewArtifact, ReviewPin } from './review-protocol.ts';

// Beads keeps pointers and form-state mapping, never the authoritative answers.
// Compare the attached standard DSL, not rendered HTML or a form ID alone.
const formKeys = ['format', 'kind', 'version', 'id', 'title', 'goal', 'description', 'task_id', 'session_id', 'parent_task_id', 'invalidatedAt', 'invalidatedReason', 'allowCodeFileChanges', 'nextInstructionPresets', 'questions'];
export function attachedFormDSL(value: Record<string, unknown>) {
  const record = parseRecord(JSON.stringify(Object.fromEntries(formKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))));
  if (!('format' in record)) throw new Error('Expected an attached standard form.');
  return record;
}
interface ResponsePointer {
  responseId: string; requestId: string; requestVersion: string; uri: string; version: string; snapshot: string;
  forms: { beadId: string; formId: string; dsl: ReviewPin; signature: string }[];
}
export async function reviewBeadMetadata(beadId: string, metadata: Record<string, any>, value: ReviewArtifact, receipt: { uri: string; version: string; snapshot: string }, read: (pin: ReviewPin) => Promise<string>) {
  const forms = await Promise.all(value.forms.map(async form => ({ beadId: form.bead_id, formId: form.form_id, dsl: form.dsl, signature: await revisionOf(JSON.stringify(attachedFormDSL(JSON.parse(await read(form.dsl))))) })));
  const pointer: ResponsePointer = { responseId: value.id, requestId: value.request.id, requestVersion: value.request.version, ...receipt, forms };
  const prior: ResponsePointer[] = Array.isArray(metadata.reviewResponsePointers) ? metadata.reviewResponsePointers : [];
  const pointers = [...prior.filter(item => item.responseId !== value.id), pointer];
  const attached: Record<string, any>[] = metadata.beadForms?.forms ?? [];
  const pending: string[] = [];
  for (const form of attached) {
    if (form.responses?.length) continue;
    let signature = '';
    try { signature = await revisionOf(JSON.stringify(attachedFormDSL(form))); } catch { /* Unknown/malformed DSL remains pending. */ }
    if (!signature || !pointers.some(pointer => pointer.forms?.some(item => item.beadId === beadId && item.formId === form.id && item.signature === signature))) pending.push(form.id);
  }
  return { reviewResponsePointers: pointers, beadFormsSummary: { hasForms: attached.length > 0, hasPendingAnswer: pending.length > 0, pendingResponseCount: pending.length, formIds: attached.map(form => form.id), pendingFormIds: pending } };
}

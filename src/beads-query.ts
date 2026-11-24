import { z } from 'zod';

export const beadsQuerySchema = z.object({
  operation: z.enum(['list', 'show', 'ready', 'blocked', 'refresh']), id: z.string().max(200).optional(),
  query: z.string().max(500).optional(), status: z.string().max(100).optional(), assignee: z.string().max(200).optional(),
  label: z.string().max(200).optional(), type: z.string().max(100).optional(),
  offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(50).default(20),
}).strict();
export type BeadsQuery = z.input<typeof beadsQuerySchema>;
export const beadsCapability = {
  name: 'beads_query', description: 'Read Beads in the current conversation workspace. Waits for background initialization. list/show/ready/blocked and explicit refresh. Search title/ID/description/notes; filter status/label/assignee/type. show requires id. Bounded results include snapshot identity and continuation. No writes or workspace override.',
  schema: beadsQuerySchema, outputSchema: z.record(z.string(), z.unknown()),
};

export function queryBeads(records: Record<string, unknown>[], input: BeadsQuery) {
  const request = beadsQuerySchema.parse(input), query = request.query?.trim().toLocaleLowerCase();
  if (request.operation === 'show' && !request.id) throw Error('show requires an exact Bead id.');
  const issues = records.filter(issue => (!request.id || issue.id === request.id)
    && (!query || [issue.id, issue.title, issue.description, issue.notes].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(query)))
    && (!request.status || issue.status === request.status) && (!request.assignee || issue.assignee === request.assignee)
    && (!request.type || issue.issue_type === request.type) && (!request.label || Array.isArray(issue.labels) && issue.labels.includes(request.label)))
    .sort((a, b) => Number(a.priority ?? 9) - Number(b.priority ?? 9) || String(a.id).localeCompare(String(b.id)));
  if (request.operation === 'show' && issues.length !== 1) throw Error('Bead not found or ambiguous in this snapshot.');
  let remaining = 28000;
  const selected: Record<string, unknown>[] = [];
  for (const issue of issues.slice(request.offset, request.offset + (request.operation === 'show' ? 1 : request.limit))) {
    const fields = ['id', 'title', 'status', 'priority', 'issue_type', 'assignee', 'labels', ...(request.operation === 'show' ? ['description', 'notes', 'design', 'acceptance_criteria', 'created_at', 'updated_at', 'closed_at'] : [])];
    const row = Object.fromEntries(fields.filter(key => issue[key] !== undefined).map(key => [key, issue[key]]));
    const text = JSON.stringify(row);
    if (text.length > remaining) { if (!selected.length) selected.push({ id: issue.id, detailText: text.slice(0, remaining), truncated: true }); break; }
    remaining -= text.length; selected.push(row);
  }
  const next = request.offset + selected.length;
  return { issues: selected, total: issues.length, ...(next < issues.length ? { nextOffset: next } : {}), complete: next >= issues.length && !selected.some(row => row.truncated) };
}

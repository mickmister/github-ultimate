import type { BeadsIssue, BeadsResult } from '../../../../hosted/beads-sample';

export type BoardIssue = {
  id: string; title: string; status: string; priority: number | null; type: string;
  assignee: string; labels: string[]; description: string; raw: BeadsIssue;
};
export type BoardFilters = { query: string; label: string; assignee: string; type: string; readiness: string; closed: boolean };
export const initialBoardFilters: BoardFilters = { query: '', label: '', assignee: '', type: '', readiness: '', closed: false };
export const statusColumns = [
  { id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' }, { id: 'deferred', label: 'Deferred' },
  { id: 'closed', label: 'Closed' }, { id: 'other', label: 'Other status' },
];
export const text = (value: unknown) => typeof value === 'string' ? value : '';
export function boardIssues(records: BeadsIssue[]): BoardIssue[] {
  const ids = new Set<string>();
  return records.map(raw => {
    const id = text(raw.id);
    if (!id || ids.has(id)) throw new Error('The snapshot contains a missing or duplicate issue ID. Refresh before browsing.');
    ids.add(id);
    return {
      id, title: text(raw.title) || '(Untitled issue)', status: text(raw.status) || 'unknown',
      priority: Number.isInteger(raw.priority) && Number(raw.priority) >= 0 && Number(raw.priority) <= 4 ? Number(raw.priority) : null,
      type: text(raw.issue_type) || 'unknown', assignee: text(raw.assignee),
      labels: Array.isArray(raw.labels) ? raw.labels.filter((value): value is string => typeof value === 'string') : [],
      description: text(raw.description), raw,
    };
  });
}
export function resultIds(result?: BeadsResult) { return new Set((result?.issues ?? []).map(issue => text(issue.id))); }
export function filterIssues(issues: BoardIssue[], filters: BoardFilters, ready: Set<string>, blocked: Set<string>) {
  const query = filters.query.trim().toLocaleLowerCase();
  return issues.filter(issue => (filters.closed || issue.status !== 'closed')
    && (!query || `${issue.id} ${issue.title}`.toLocaleLowerCase().includes(query))
    && (!filters.label || issue.labels.includes(filters.label))
    && (!filters.assignee || (filters.assignee === '__unassigned' ? !issue.assignee : issue.assignee === filters.assignee))
    && (!filters.type || issue.type === filters.type)
    && (!filters.readiness || (filters.readiness === 'ready' ? ready : blocked).has(issue.id)))
    .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || a.id.localeCompare(b.id));
}

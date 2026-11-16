import type { BeadsIssue, BeadsOperation, BeadsResult } from '../../hosted/beads-sample';

export const fixtureIssues: BeadsIssue[] = [
  { id: 'demo-1', title: 'Ship the workspace dashboard', status: 'open', priority: 1, issue_type: 'epic', labels: ['dashboard'], description: 'An epic with work in several repositories.', assignee: 'alex' },
  { id: 'demo-1.1', title: 'Build the native reader', status: 'in_progress', priority: 0, issue_type: 'task', labels: ['engine'], assignee: 'sam', description: 'Read the authoritative binary snapshot.\nKeep the application read-only.', created_at: '2026-11-10T12:00:00Z' },
  { id: 'demo-1.2', title: 'Wire workspace navigation', status: 'open', priority: 1, issue_type: 'feature', labels: ['dashboard', 'mobile'], description: 'This open task is dependency-blocked, not stored as blocked.', blocked_by: ['demo-1.1'] },
  { id: 'demo-2', title: 'Wait for device feedback', status: 'blocked', priority: 2, issue_type: 'task', labels: ['mobile'], assignee: 'alex' },
  { id: 'demo-3', title: 'Explore an optional layout', status: 'deferred', priority: 3, issue_type: 'task', labels: [] },
  { id: 'demo-4', title: 'Document the snapshot contract', status: 'closed', priority: 2, issue_type: 'task', labels: ['engine'] },
  { id: 'demo-5', title: 'A custom workflow state remains visible', status: 'awaiting_review', priority: 4, issue_type: 'task', labels: [] },
];
export function fixtureResults(issues = fixtureIssues): BeadsResult[] {
  const result = (operation: BeadsOperation, records: BeadsIssue[]): BeadsResult => ({ operation, issues: records, request: { operation }, durationMs: 4 });
  return [result('list', issues), result('ready', issues.filter(issue => issue.id === 'demo-1')), result('blocked', issues.filter(issue => issue.id === 'demo-1.2'))];
}

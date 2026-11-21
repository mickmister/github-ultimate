import { describe, expect, it } from 'vitest';
import { boardIssues, filterIssues, initialBoardFilters } from '../webapp/src/features/beads/board';
import { fixtureIssues } from '../webapp/stories/beads.fixtures';

describe('Beads board semantics', () => {
  it('keeps stored status separate from native readiness and preserves child IDs', () => {
    const issues = boardIssues(fixtureIssues), blocked = new Set(['demo-1.2']);
    const result = filterIssues(issues, { ...initialBoardFilters, readiness: 'blocked' }, new Set(), blocked);
    expect(result.map(issue => [issue.id, issue.status])).toEqual([['demo-1.2', 'open']]);
    expect(filterIssues(issues, initialBoardFilters, new Set(), blocked).map(issue => issue.id)).toEqual(['demo-1.1', 'demo-1', 'demo-1.2', 'demo-2', 'demo-3', 'demo-5']);
  });
  it('combines search, labels, assignee, type and closed filters', () => {
    const issues = boardIssues(fixtureIssues);
    expect(filterIssues(issues, { ...initialBoardFilters, query: 'DEMO-1.2', label: 'mobile', assignee: '__unassigned', type: 'feature' }, new Set(), new Set()).map(issue => issue.id)).toEqual(['demo-1.2']);
    expect(filterIssues(issues, { ...initialBoardFilters, closed: true }, new Set(), new Set())).toHaveLength(7);
    expect(filterIssues(issues, { ...initialBoardFilters, query: 'missing' }, new Set(), new Set())).toEqual([]);
  });
  it('rejects ambiguous IDs and retains unsupported field values honestly', () => {
    expect(() => boardIssues([{ id: 'one' }, { id: 'one' }])).toThrow('duplicate');
    expect(() => boardIssues([{}])).toThrow('missing');
    expect(boardIssues([{ id: 'x', priority: '1', labels: [1, 'label'] }])[0]).toMatchObject({ id: 'x', status: 'unknown', priority: null, labels: ['label'] });
  });
  it('searches the complete parsed collection, including content outside the rendered page', () => {
    const issues = boardIssues(Array.from({ length: 2000 }, (_, index) => ({ id: `task-${index}`, title: 'Common title', description: index === 1999 ? 'Needle in the final description' : '', labels: ['searchable-label'], assignee: 'owner' })));
    expect(filterIssues(issues, { ...initialBoardFilters, query: 'needle' }, new Set(), new Set()).map(issue => issue.id)).toEqual(['task-1999']);
    expect(filterIssues(issues, { ...initialBoardFilters, query: 'searchable-label' }, new Set(), new Set())).toHaveLength(2000);
  });
});

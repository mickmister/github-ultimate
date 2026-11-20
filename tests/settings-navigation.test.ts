import { describe, expect, it } from 'vitest';
import { navigationItems, workspaceSearch } from '../webapp/src/features/navigation/navigation';

describe('shared workspace navigation', () => {
  it('carries workspace scope to all destinations, without review pins or credentials', () => {
    const items = navigationItems('/reviews/request-1', { connection: 'host', repository: 'owner/repo', workspace: 'work one', request: 'request-1', review: 'pin', token: 'secret', documentId: 'doc' });
    expect(items.map(item => item.label)).toEqual(['Home', 'Documents', 'Reviews', 'Beads', 'Agent', 'Runs', 'Settings']);
    for (const item of items) {
      const url = new URL(item.href.slice(1), 'https://app.example');
      expect([...url.searchParams.keys()]).toEqual(['connection', 'repository', 'workspace']);
      expect(url.searchParams.get('workspace')).toBe('work one');
    }
    expect(items.filter(item => item.active).map(item => item.key)).toEqual(['reviews']);
  });
  it('marks appearance as Settings and rejects malformed scope values', () => {
    expect(navigationItems('/settings/appearance', {}).filter(item => item.active).map(item => item.key)).toEqual(['settings']);
    expect(workspaceSearch({ connection: [], repository: 42, workspace: ' ' })).toEqual({});
    expect(navigationItems('/documents-extra', {}).some(item => item.active)).toBe(false);
  });
});

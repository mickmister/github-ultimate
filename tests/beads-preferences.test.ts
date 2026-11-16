import { expect, test } from 'vitest';
import { boardPreferencesKey, defaultPreferences, lastWorkspaceKey, readPreferences, readWorkspace, saveFilter, workspaceChoice } from '../webapp/src/features/beads/preferences';

test('restores a whole workspace choice and gives explicit links precedence without mixing scopes', () => {
  const saved = { connection: 'saved-connection', repository: 'example/storage', workspace: 'first' };
  expect(readWorkspace(JSON.stringify(saved))).toEqual(saved);
  expect(workspaceChoice(new URLSearchParams(), saved, 'default')).toEqual(saved);
  expect(workspaceChoice(new URLSearchParams('repository=other/storage&workspace=second'), saved, 'approved')).toEqual({ connection: 'approved', repository: 'other/storage', workspace: 'second' });
  expect(workspaceChoice(new URLSearchParams('workspace=second'), saved, 'approved')).toEqual({ connection: 'approved', repository: '', workspace: 'second' });
  expect(readWorkspace('{broken')).toBeUndefined();
  expect(readWorkspace(JSON.stringify({ ...saved, repository: '../storage' }))).toBeUndefined();
});

test('preserves independent named filter snapshots and validates saved values', () => {
  const first = { ...defaultPreferences(), filters: { ...defaultPreferences().filters, label: 'mobile', query: 'test' } };
  const saved = saveFilter(first, '  My work  ');
  const next = { ...saved, filters: { ...saved.filters, query: 'changed' } };
  expect(next.views[0].filters.query).toBe('test');
  expect(saveFilter(next, 'My work').views).toHaveLength(1);
  expect(readPreferences(JSON.stringify(saved), 'compact')).toEqual(saved);
  expect(readPreferences(JSON.stringify({ ...saved, views: [...saved.views, saved.views[0]], filters: { closed: 'true', readiness: 'invented' } }), 'compact')).toMatchObject({ views: saved.views, filters: { closed: false, readiness: '' } });
  expect(readPreferences('{broken', 'comfortable')).toEqual(defaultPreferences('comfortable'));
  expect(() => saveFilter(saved, ' ')).toThrow('filter name');
  expect(() => saveFilter({ ...saved, filters: { ...saved.filters, query: 'x'.repeat(4096) } }, 'Too much')).toThrow('full');
});

test('isolates workspace filter keys within native storage key bounds', async () => {
  const first = await boardPreferencesKey(JSON.stringify({ connection: 'a', repository: 'example/storage', workspace: 'first' }));
  const second = await boardPreferencesKey(JSON.stringify({ connection: 'b', repository: 'example/storage', workspace: 'first' }));
  expect(first).not.toBe(second);
  expect(first.length).toBeLessThanOrEqual(256);
  expect(first).not.toBe(lastWorkspaceKey);
});

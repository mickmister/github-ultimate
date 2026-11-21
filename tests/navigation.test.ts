import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadNavigation, saveNavigation, forgetNavigation, type Navigation } from '../hosted/navigation';

const data = new Map<string, string>();
const navigation: Navigation = { connectionId: crypto.randomUUID(), installationId: 123, repository: 'owner/storage', workspace: 'planning', discovered: true };
beforeEach(() => {
  data.clear();
  vi.stubGlobal('location', { pathname: '/previews/one/' });
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
test('only navigation fields are saved and previews remain isolated', () => {
  expect(saveNavigation({ ...navigation, content: 'private document', token: 'secret' } as Navigation)).toBe(true);
  expect([...data.values()].join('')).not.toMatch(/private document|secret|content|token/);
  expect(loadNavigation()).toEqual(navigation);
  location.pathname = '/previews/one/settings.html'; expect(loadNavigation()).toEqual(navigation);
  location.pathname = '/previews/one/index.html'; expect(loadNavigation()).toEqual(navigation);
  location.pathname = '/previews/two/'; expect(loadNavigation()).toBeUndefined();
  saveNavigation({ ...navigation, workspace: 'other' }); forgetNavigation();
  location.pathname = '/previews/one/'; expect(loadNavigation()).toEqual(navigation);
});
test('invalid saved data and unavailable browser storage do not break the page', () => {
  for (const value of ['{bad json', JSON.stringify({ ...navigation, repository: '../storage' }), JSON.stringify({ ...navigation, workspace: '../outside' }), JSON.stringify({ ...navigation, installationId: 0 })]) {
    localStorage.setItem('github-ultimate-navigation-v1:/previews/one/', value);
    expect(loadNavigation()).toBeUndefined();
  }
  vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
  expect(loadNavigation()).toBeUndefined(); expect(saveNavigation(navigation)).toBe(false); expect(() => forgetNavigation()).not.toThrow();
});

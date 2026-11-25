import { expect, test } from 'vitest';
import { chatRoute, inChatScope, routeURL } from '../pi-web/client/chat/chat-route';

test('URL scope requires remote store identity and never implicitly selects Unassigned', () => {
  expect(chatRoute('')).toEqual({ kind: 'chooser' });
  expect(chatRoute('?conversations=unassigned')).toEqual({ kind: 'inbox' });
  for (const query of ['?workspace=work', '?repository=owner/store', '?repository=../store&workspace=work']) expect(() => chatRoute(query)).toThrow('valid');
  expect(inChatScope(chatRoute(''), undefined)).toBe(false);
  const workspace = { repository: 'owner/store', workspace: 'work' };
  expect(inChatScope(chatRoute('?repository=owner/store&workspace=work'), workspace)).toBe(true);
  expect(inChatScope(chatRoute('?repository=other/store&workspace=work'), workspace)).toBe(false);
  expect(inChatScope(chatRoute('?conversations=unassigned'), workspace)).toBe(false);
});
test('workspace navigation drops conversation identity and device-local authorization hints', () => {
  const current = new URL('https://example.com/pi-web/?connection=local&installation=7&session=id&checkpoint=pin&storage=s3&view=checkpoint&repository=old/store&workspace=old');
  const route = chatRoute('?repository=owner/store&workspace=work'), url = routeURL(current, route);
  expect([...url.searchParams]).toEqual([['repository', 'owner/store'], ['workspace', 'work']]);
  const shared = routeURL(current, route, true);
  expect(shared.searchParams.get('checkpoint')).toBe('pin'); expect(shared.searchParams.has('connection')).toBe(false);
  expect(routeURL(current, { kind: 'chooser' }).search).toBe('');
  expect(routeURL(current, { kind: 'inbox' }).search).toBe('?conversations=unassigned');
});

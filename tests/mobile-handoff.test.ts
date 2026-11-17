import { expect, it } from 'vitest';
import { mobileHandoff } from '../src/mobile-handoff';
import { resolveAlohakLink } from '../src/mobile-protocol';

const entry = 'https://mickmister.github.io/github-ultimate/previews/example/app/';
const target = `${entry}?source=chat#/reviews/request?repository=mickmister%2Fworkspace-storage&workspace=workspace&version=${'a'.repeat(40)}&snapshot=${'b'.repeat(40)}`;
it.each(['iPhone', 'Android', 'iPad'])('preserves the complete HTTPS route and review pins for %s', userAgent => {
  const handoff = mobileHandoff(target, userAgent)!;
  expect(handoff.entryURL).toBe(entry);
  expect(resolveAlohakLink(handoff.appURL, entry)).toBe(target);
  expect(() => resolveAlohakLink(handoff.appURL, entry.replace('/app/', '/isolation/'))).toThrow('outside');
});
it('supports iPad desktop user agents and explicit index.html deployments', () => {
  const handoff = mobileHandoff(`${entry}index.html#/documents/a%3Adocuments%2Freadme.md`, 'Macintosh', 5)!;
  expect(handoff.entryURL).toBe(entry);
  expect(resolveAlohakLink(handoff.appURL, entry)).toBe(`${entry}index.html#/documents/a%3Adocuments%2Freadme.md`);
});
it('does not hand off again inside Alohak, on desktop, or from invalid deployments', () => {
  expect(mobileHandoff(target, 'iPhone Alohak/1')).toBeUndefined();
  expect(mobileHandoff(target, 'Macintosh')).toBeUndefined();
  expect(mobileHandoff('http://example.test/app/', 'Android')).toBeUndefined();
  expect(mobileHandoff('https://user:secret@example.test/app/', 'iPhone')).toBeUndefined();
});

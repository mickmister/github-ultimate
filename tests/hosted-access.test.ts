import { expect, test } from 'vitest';
import { hostedGrants, loadedDocument, matchesGrant, trustedSubpath } from '../src/hosted-access';

test('directory grants use exact origins and segment boundaries, independent of queries and fragments', () => {
  const grant = { origin: 'https://example.test:8443', subpath: trustedSubpath('/app') };
  for (const path of ['/app', '/app/', '/app/doc?other=/elsewhere/#/page']) expect(matchesGrant(grant, loadedDocument(grant.origin + path))).toBe(true);
  for (const url of ['https://example.test/app/', 'https://example.test:8443/application/', 'https://example.test:8443/App/', 'https://example.test:8443/other/?path=/app/']) expect(matchesGrant(grant, loadedDocument(url))).toBe(false);
  expect(trustedSubpath('')).toBe('/');
  expect(trustedSubpath('/app/')).toBe('/app/');
  for (const path of ['//other/', '/a/../', '/%2e%2e/', '/a%2fb/', '/a%5cb/', '/a%252fb/', '/a\\b', '/a?b', '/a#b', '/a*', '/%zz']) expect(() => trustedSubpath(path)).toThrow();
  expect(() => loadedDocument('https://example.test/app/%252e%252e/other')).toThrow();
});

test('legacy origins map to explicit root grants but cannot resurrect after narrowing', () => {
  const origin = 'https://example.test';
  expect(hostedGrants({ origins: [origin] })).toEqual([{ origin, subpath: '/' }]);
  expect(hostedGrants({ origins: [origin], hostedGrants: [] })).toEqual([]);
  expect(hostedGrants({ origins: [origin], hostedGrants: [{ origin, subpath: '/app/' }] })).toEqual([{ origin, subpath: '/app/' }]);
});

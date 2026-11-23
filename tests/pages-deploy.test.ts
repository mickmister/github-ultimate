import { expect, test } from 'vitest';
import { deployPages } from '../cli/deploy-pages';

test('Pages deployment uses the exact upload ID and OIDC without an artifact listing', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const responses = [{ value: 'private-oidc' }, { id: '123-456', page_url: 'https://example.github.io/app/' }, { status: 'deployment_in_progress' }, { status: 'succeed' }];
  const result = await deployPages({ GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), PAGES_ARTIFACT_ID: '123', GITHUB_TOKEN: 'private-github', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private-request' }, (async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json(responses.shift());
  }) as typeof fetch, async () => {});
  expect(result).toEqual({ page_url: 'https://example.github.io/app/', deployment_id: '123-456' });
  expect(calls.map(call => call.url)).toEqual(['https://oidc.example/token', 'https://api.github.com/repos/owner/repo/pages/deployments', 'https://api.github.com/repos/owner/repo/pages/deployments/123-456', 'https://api.github.com/repos/owner/repo/pages/deployments/123-456']);
  expect(JSON.parse(calls[1].init!.body as string)).toEqual({ artifact_id: '123', pages_build_version: 'a'.repeat(40), oidc_token: 'private-oidc' });
  expect(JSON.stringify(result)).not.toMatch(/private-/);
});

test('Pages API failures do not expose response bodies', async () => {
  let count = 0;
  await expect(deployPages({ GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), PAGES_ARTIFACT_ID: '123', GITHUB_TOKEN: 'private-github', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private-request' }, (async () => ++count === 1 ? Response.json({ value: 'private-oidc' }) : new Response('private-provider-body', { status: 403 })) as typeof fetch, async () => {})).rejects.toThrow('Pages deployment creation failed (HTTP 403).');
});

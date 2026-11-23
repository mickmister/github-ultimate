import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type Deployment = { id: string; page_url: string };
export async function deployPages(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch, pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms))) {
  const repository = env.GITHUB_REPOSITORY, sha = env.GITHUB_SHA, artifact = env.PAGES_ARTIFACT_ID;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '') || !/^\d+$/.test(artifact ?? '') || !env.GITHUB_TOKEN || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw Error('Missing repository-scoped Pages deployment configuration.');
  // Tokens remain in request headers/bodies, never command arguments or logs.
  const oidc = await fetcher(env.ACTIONS_ID_TOKEN_REQUEST_URL, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!oidc.ok) throw Error(`Pages OIDC request failed (HTTP ${oidc.status}).`);
  const { value } = await oidc.json() as { value?: string };
  if (!value || typeof value !== 'string') throw Error('Pages OIDC response is invalid.');
  const endpoint = `https://api.github.com/repos/${repository}/pages/deployments`;
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  // Use the uploader's exact ID. Artifact-service listing can lag behind the
  // completed upload even when the repository REST API already shows the file.
  const created = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify({ artifact_id: artifact, pages_build_version: sha, oidc_token: value }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!created.ok) throw Error(`Pages deployment creation failed (HTTP ${created.status}).`);
  const deployment = await created.json() as Deployment;
  if (!/^[\w-]+$/.test(String(deployment.id)) || typeof deployment.page_url !== 'string') throw Error('Pages deployment response is invalid.');
  const page = new URL(deployment.page_url);
  if (page.protocol !== 'https:' || page.username || page.password || /[\r\n]/.test(deployment.page_url)) throw Error('Pages deployment URL is invalid.');
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(5000);
    const response = await fetcher(`${endpoint}/${encodeURIComponent(deployment.id)}`, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Error(`Pages deployment polling failed (HTTP ${response.status}).`);
    const { status } = await response.json() as { status?: string };
    if (status === 'succeed') return { page_url: page.href, deployment_id: String(deployment.id) };
    if (['deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost'].includes(status ?? '')) throw Error(`Pages deployment did not succeed (${status}).`);
  }
  throw Error('Pages deployment timed out. Check its status before retrying.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await deployPages(process.env);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `page_url=${result.page_url}\ndeployment_id=${result.deployment_id}\n`);
    console.log(JSON.stringify(result));
  } catch (error) {
    // Fetch/response exceptions can include transport details. Only expose our
    // bounded operational messages; never echo provider bodies or OIDC payloads.
    console.error(error instanceof Error && /^Pages |^Missing repository-scoped/.test(error.message) ? error.message : 'Pages deployment transport failed.');
    process.exitCode = 1;
  }
}

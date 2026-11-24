import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { buildWorkflowWorker } from '../../scripts/build-workflow-worker.mjs';
import { Connections, type ConnectionRecord } from '../../src/connections';
import { developmentHost, workflowRunName } from '../../src/workflow-interface';
import { gitObject } from '../../src/scratch';

let server: Server, url: string;
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(async ({}, info) => {
  const root = resolve('test-results/workflow-fixture', info.project.name); await mkdir(root, { recursive: true });
  const worker = await buildWorkflowWorker(root);
  await build({ entryPoints: ['tests/fixtures/workflow-client.ts'], outfile: `${root}/client.js`, bundle: true, format: 'esm', platform: 'browser', define: worker.define });
  await writeFile(`${root}/index.html`, '<!doctype html><script type="module" src="./client.js"></script>');
  server = createServer(async (request, response) => {
    const file = resolve(root, new URL(request.url!, 'http://localhost').pathname.slice(1) || 'index.html');
    if (!file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
    try { response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok)); url = `http://127.0.0.1:${(server.address() as any).port}/`;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(ok => server.close(() => ok())); });

for (const failAfterLaunch of [false, true]) test(`real Pi → QuickJS → authenticated broker launch survives restore${failAfterLaunch ? ' and script failure' : ''}`, async ({ page }) => {
  const id = crypto.randomUUID(), origin = new URL(url).origin, engineCommit = 'a'.repeat(40);
  let record: ConnectionRecord = { id, name: 'GitHub', appId: 1, clientId: 'client', user: { id: 6913320, login: 'owner' }, installation: { id: 7, account: 'owner' }, tokens: { accessToken: 'private-never-in-browser', expiresAt: Date.now() + 3600000 }, hostedGrants: [{ origin, subpath: '/' }] };
  const store = { all: async () => [structuredClone(record)], get: async () => structuredClone(record), put: async (next: ConnectionRecord) => { record = structuredClone(next); }, remove: async () => {} };
  let posts = 0;
  const manifest = JSON.stringify({ schema_version: 1, workspace: 'workspace', observed_at: new Date().toISOString(), repositories: [{ path: 'app', branch: 'refs/heads/main', commit: 'b'.repeat(40), remotes: [{ name: 'origin', url: 'https://github.com/owner/app.git' }], publication: 'unverified' }] });
  const candidate = 'c'.repeat(40), result = { schemaVersion: 1, workspace: 'workspace', thread: 'conversation', process: 'request-1', executionId: '42-1', status: 'accepted', currentStep: 'candidate-accepted', nextStep: 'human-review-candidate', cycle: 1, candidate, testsPassed: true, evaluations: ['reviewer-1', 'reviewer-2', 'tester'].map(role => ({ role, candidate, approval: 'approve' })) };
  const report = `# Development candidate\n\n## Result contract\n\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n`;
  const blobs = new Map([manifest, report].map(text => [gitObject('blob', text), text]));
  const broker = new Connections(store, async (input) => {
    const path = String(input);
    if (path.includes('/user/installations?')) return Response.json({ installations: [{ id: 7, app_id: 1, account: { login: 'owner' }, permissions: { actions: 'write', contents: 'read' } }] });
    if (path.includes('/user/installations/7/repositories?')) return Response.json({ repositories: [{ full_name: developmentHost.repository, private: false, default_branch: developmentHost.ref }, { full_name: 'owner/storage', private: true, default_branch: 'main' }] });
    if (path.includes('/repos/owner/storage/git/')) {
      if (path.includes('/matching-refs/documents/')) return Response.json([{ ref: 'refs/documents/workspace', object: { sha: 'd'.repeat(40), type: 'commit' } }]);
      if (path.includes('/commits/')) return Response.json({ sha: 'd'.repeat(40), tree: { sha: 'e'.repeat(40) } });
      if (path.includes('/trees/')) return Response.json({ sha: 'e'.repeat(40), truncated: false, tree: [{ path: 'documents/workspace/manifest.json', mode: '100644', type: 'blob', sha: gitObject('blob', manifest), size: Buffer.byteLength(manifest) }, { path: 'documents/threads/conversation/development/request-1.md', mode: '100644', type: 'blob', sha: gitObject('blob', report), size: Buffer.byteLength(report) }] });
      const sha = path.split('/blobs/')[1], text = blobs.get(sha); if (text) return Response.json({ sha, size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (path.includes('/commits/')) return Response.json({ sha: engineCommit });
    if (path.endsWith('/dispatches')) { posts++; return new Response(null, { status: 204 }); }
    if (path.includes('/runs?') || path.endsWith('/actions/runs/42')) {
      const delivery = Object.values(record.workflowDeliveries!)[0];
      const run = { id: 42, run_attempt: 1, display_title: workflowRunName(delivery), event: 'workflow_dispatch', head_sha: engineCommit, head_branch: developmentHost.ref, actor: { id: 6913320 }, created_at: delivery.attemptedAt, status: 'completed', conclusion: 'success' };
      return Response.json(path.includes('/runs?') ? { workflow_runs: [run] } : run);
    }
    throw Error(`Unexpected ${path}`);
  });
  await page.exposeFunction('workflowHost', (input: unknown) => broker.handleHosted(url, input));
  await page.goto(url); await page.waitForFunction(() => !!window.workflowExperiment);
  const request = { schemaVersion: 2, process: 'request-1', thread: 'conversation', member: 'app', baseCommit: 'b'.repeat(40), task: 'Fix source', acceptanceCriteria: ['Checks pass'], publishCandidate: false };
  const code = `const catalog = await tools.workflows_list({}); const receipt = await tools.workflow_start({connectionRef:catalog.connections[0].connectionRef,workspace:'workspace',request:${JSON.stringify(request)},allowSourceEffects:true}); text(receipt); ${failAfterLaunch ? 'throw Error("After launch failure")' : ''}`;
  const first = await page.evaluate(code => window.workflowExperiment.run(code), code);
  expect(first.snapshot.error).toBeUndefined(); expect(first.journaled).toBe(true); expect(posts).toBe(1);
  expect(first.checkpoint.messages.some(m => m.role === 'toolResult')).toBe(true);
  expect(JSON.stringify(first)).not.toContain('private-never-in-browser');
  const receipt = Object.values(record.workflowDeliveries!)[0];
  await page.evaluate(() => window.workflowExperiment.restore());
  const checked = await page.evaluate(reference => window.workflowExperiment.run(`const c=await tools.workflows_list({}); text(await tools.workflow_status({connectionRef:c.connections[0].connectionRef,executionReference:${JSON.stringify(reference)},reportWorkspace:{repository:'owner/storage',workspace:'workspace'}}));`), receipt.executionReference);
  expect(checked.snapshot.error).toBeUndefined(); expect(posts).toBe(1);
  const text = JSON.stringify(checked.checkpoint.messages.filter(m => m.role === 'toolResult').at(-1));
  expect(text).toContain('accepted'); expect(text).toContain('completed'); expect(text).toContain('testsPassed'); expect(text).toContain('documents%2Fthreads');
});

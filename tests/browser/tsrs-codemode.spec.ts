import { test, expect, type Page } from '@playwright/test';
import type { CodemodeResult } from '@earendil-works/pi-codemode/portable';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname } from 'node:path';
import { Scratch, gitTreeEntries, type ScratchState } from '../../src/scratch';

const require = createRequire(import.meta.url);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let server: Server, origin: string;
const base = '/previews/nested/tsrs-codemode/';
test.beforeAll(async ({}, info) => {
  expect(JSON.parse(await readFile(require.resolve('@tsrs/wasm/package.json'), 'utf8')).version).toBe('7.1.0-beta.tsrs5');
  const root = resolve('test-results/tsrs-fixture', info.project.name);
  await mkdir(root, { recursive: true });
  await build({ entryPoints: ['experiments/tsrs-codemode/client.ts', 'experiments/tsrs-codemode/worker.ts'], outdir: root, bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'safari16.4'], metafile: true }).then(result => {
    expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith('@tsrs/wasm/browser.js'))).toBe(true);
    expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith('@tsrs/wasm/node.js'))).toBe(false);
  });
  await cp(require.resolve('@tsrs/wasm/tsrs.wasm'), resolve(root, 'tsrs.wasm'));
  await cp(require.resolve('quickjs-wasi/quickjs.wasm'), resolve(root, 'quickjs.wasm'));
  await writeFile(resolve(root, 'index.html'), '<!doctype html><title>Browser compiler experiment</title><script type="module" src="./client.js"></script>');
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    const file = resolve(root, path.slice(base.length) || 'index.html');
    if (!path.startsWith(base) || !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
    try {
      response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}${base}`;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(done => server.close(() => done())); });

function fixture(extra: Record<string, string> = {}, unrelated = false): ScratchState {
  const input = {
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', types: [], paths: { '#model': ['./src/model.ts'] } } }),
    'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', include: ['src/**/*.ts'] }),
    'src/model.ts': 'export const value: number = 1;',
    'src/use.ts': 'import { value } from "#model"; export const result: number = value;',
    'src/unrelated.ts': unrelated ? 'export const unrelated: boolean = "bad";' : 'export const unrelated: boolean = true;',
    ...extra,
  };
  return { version: 1, revision: 0, origin: null, files: Object.entries(input).map(([path, content]) => ({ path, content, mode: '100644' })), commits: [] };
}
async function open(page: Page, state = fixture()) {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.tsrsExperiment);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.evaluate(state => window.tsrsExperiment.reset(state), state);
}
const check = (scope = 'project', files?: string[]) => `await tools.type_check(${JSON.stringify({ project: 'tsconfig.json', scope, ...(files ? { files } : {}) })})`;
async function run(page: Page, code: string) { return page.evaluate(code => window.tsrsExperiment.run(code), code); }
function output(response: { result?: CodemodeResult; error?: string }) {
  expect(response.error).toBeUndefined();
  expect(response.result?.ok, JSON.stringify(response.result)).toBe(true);
  return response.result!.output.filter(item => item.type === 'text').map(item => JSON.parse(item.text));
}
async function snapshot(page: Page) { return page.evaluate(() => window.tsrsExperiment.snapshot()); }

test('real Pi codemode checks same-script dirty imports, selected reporting and full-project repair', async ({ page }) => {
  await open(page, fixture({}, true));
  const result = await run(page, `
    const f = await tools.read_file({path:'src/model.ts'});
    await tools.write_file({path:f.path, content:'export const value: string = "changed";', expectedRevision:f.revision});
    text(${check('files', ['src/model.ts'])});
    text(${check('files', ['src/use.ts'])});
    text(${check()});
    text({fetch:typeof fetch, process:typeof process, wasm:typeof WebAssembly});
    const status = await tools.git_status({});
    await tools.write_file({path:'src/model.ts', content:'export const value: number = 2;', expectedRevision:status.revision});
    const next = await tools.git_status({});
    await tools.write_file({path:'src/unrelated.ts', content:'export const unrelated: boolean = true;', expectedRevision:next.revision});
    text(${check()});
    text(await tools.git_diff({}));
  `);
  const [model, consumer, project, globals, fixed, diff] = output(result);
  expect(model).toMatchObject({ ok: true, scope: 'files', projectPassed: false, complete: true, diagnostics: [], projectDiagnosticCount: 2, revision: 1 });
  expect(consumer).toMatchObject({ ok: false, projectPassed: false, diagnosticCount: 1, diagnostics: [{ file: 'src/use.ts', code: 2322 }] });
  expect(project).toMatchObject({ ok: false, projectPassed: false, diagnosticCount: 2, revision: 1, engineVersion: '7.1.0-beta.tsrs5' });
  expect(project.programFiles).toEqual(expect.arrayContaining(['src/model.ts', 'src/use.ts', 'src/unrelated.ts']));
  expect(globals).toEqual({ fetch: 'undefined', process: 'undefined', wasm: 'undefined' });
  expect(fixed).toMatchObject({ ok: true, projectPassed: true, complete: true, diagnostics: [], revision: 3 });
  expect(fixed.memoryBytes).toBeGreaterThan(32 * 1024 * 1024);
  expect(diff.changes.map((f: { path: string }) => f.path)).toContain('src/model.ts');
  expect((await snapshot(page)).revision).toBe(3);
  expect(result.result!.calls.filter(call => call.name === 'type_check')).toHaveLength(4);
});

test('missing dependency types fail, real declarations resolve and UTF-16 diagnostic positions survive codemode', async ({ page }) => {
  await open(page, fixture({ 'src/use.ts': 'import { getValue } from "demo"; export const result: number = getValue();' }));
  const result = await run(page, `
    text(${check()});
    const a = await tools.git_status({});
    await tools.write_file({path:'node_modules/demo/package.json', content:'{"name":"demo","types":"index.d.ts"}', expectedRevision:a.revision});
    const b = await tools.git_status({});
    await tools.write_file({path:'node_modules/demo/index.d.ts', content:'export declare function getValue(): string;', expectedRevision:b.revision});
    text(${check()});
    const c = await tools.git_status({});
    await tools.write_file({path:'node_modules/demo/index.d.ts', content:'export declare function getValue(): number;', expectedRevision:c.revision});
    const d = await tools.git_status({});
    await tools.write_file({path:'src/unicode.ts', content:'/* 🌴 */ export const value: number = "bad";', expectedRevision:d.revision});
    text(${check()});
  `);
  const [missing, typed, unicode] = output(result);
  expect(missing.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2307, file: 'src/use.ts' })]));
  expect(typed.diagnostics).toEqual([expect.objectContaining({ code: 2322, file: 'src/use.ts' })]);
  expect(unicode.diagnostics).toEqual([expect.objectContaining({ code: 2322, file: 'src/unicode.ts', start: { line: 0, character: 22 } })]);
});

test('type diagnostics are data; an explicit script error rolls back edits even after a successful compiler call', async ({ page }) => {
  await open(page);
  const before = await snapshot(page);
  const result = await run(page, `await tools.write_file({path:'src/model.ts', content:'export const value: string = "changed";', expectedRevision:0}); text(${check()}); throw Error('reject this edit');`);
  expect(result.result).toMatchObject({ ok: false, error: { kind: 'script', message: 'reject this edit' } });
  expect(result.result!.calls).toContainEqual(expect.objectContaining({ name: 'type_check', status: 'ok' }));
  expect(await snapshot(page)).toEqual(before);
});

test('rejects invalid paths and selections outside the program instead of claiming a pass', async ({ page }) => {
  await open(page, fixture({ 'excluded.ts': 'export const bad: number = "bad";' }));
  for (const input of [
    { project: '../tsconfig.json', scope: 'project' },
    { project: 'tsconfig.json', scope: 'files', files: [] },
    { project: 'tsconfig.json', scope: 'files', files: ['absent.ts'] },
    { project: 'tsconfig.json', scope: 'files', files: ['excluded.ts'] },
    { project: 'tsconfig.json', scope: 'project', args: ['--noCheck'] },
  ]) {
    const result = await run(page, `text(await tools.type_check(${JSON.stringify(input)}));`);
    expect(result.result).toMatchObject({ ok: false });
    expect(result.result!.calls).toContainEqual(expect.objectContaining({ name: 'type_check', status: 'error' }));
  }
});

test('noCheck in project config cannot bypass semantic checking, and configuration errors are reported', async ({ page }) => {
  await open(page, fixture({ 'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { noCheck: true }, include: ['src/**/*.ts'] }) }, true));
  const [semantic] = output(await run(page, `text(${check()});`));
  expect(semantic).toMatchObject({ ok: false, projectPassed: false, diagnostics: [{ code: 2322 }] });
  await open(page, fixture({ 'tsconfig.json': '{"compilerOptions":{"notACompilerOption":true},"files":["src/model.ts"]}' }));
  const [config] = output(await run(page, `text(${check()});`));
  expect(config.projectPassed).toBe(false);
  expect(config.diagnostics).toContainEqual(expect.objectContaining({ code: 5023 }));
});

test('selected reports retain global diagnostics and large result sets declare truncation', async ({ page }) => {
  await open(page, fixture({ 'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { types: ['missing-types-package'] }, include: ['src/**/*.ts'] }) }));
  const [globals] = output(await run(page, `text(${check('files', ['src/model.ts'])});`));
  expect(globals).toMatchObject({ ok: false, projectPassed: false });
  expect(globals.diagnostics).toContainEqual(expect.objectContaining({ code: 2688 }));
  await open(page, fixture({ 'src/errors.ts': Array.from({ length: 140 }, (_, i) => `export const v${i}: number = "bad";`).join('\n') }));
  const [large] = output(await run(page, `text(${check()});`));
  expect(large).toMatchObject({ ok: false, projectPassed: false, complete: false, truncated: true, diagnosticCount: 140 });
  expect(large.diagnostics).toHaveLength(100);
});

test('refuses incomplete lazy workspaces and oversized writes without changing scratch', async ({ page }) => {
  const tree = gitTreeEntries([]);
  await open(page, { version: 1, revision: 0, origin: { repository: 'owner/repo', commit: 'a'.repeat(40), directory: '' }, base: { tree, trees: { [tree]: [] } }, files: [{ path: 'tsconfig.json', content: '{}', mode: '100644' }], commits: [] });
  const lazy = await run(page, `text(${check()});`);
  expect(lazy.result).toMatchObject({ ok: false, error: { message: expect.stringContaining('fully materialized') } });
  await open(page);
  const before = await snapshot(page);
  const huge = await run(page, `await tools.write_file({path:'huge.ts',content:'x'.repeat(128*1024+1),expectedRevision:0}); text(${check()});`);
  expect(huge.result).toMatchObject({ ok: false });
  expect(huge.result!.calls.some(call => call.name === 'type_check')).toBe(false);
  expect(await snapshot(page)).toEqual(before);
});

for (const stop of ['cancel', 'timeout'] as const) test(`${stop} during compiler loading reclaims the only worker and discards edits`, async ({ page }) => {
  await open(page);
  const before = await snapshot(page);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  await page.route('**/tsrs.wasm', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    const promise = runWithTimeout(page, `await tools.write_file({path:'src/model.ts',content:'export const value: string = "cancelled";',expectedRevision:0}); text(${check()});`, stop === 'timeout' ? 4000 : 45_000);
    await expect.poll(() => page.evaluate(() => window.tsrsExperiment.events())).toContain('typecheck-started');
    // The UI thread can still service requests while the compiler worker waits.
    expect(await page.evaluate(() => 6 * 7)).toBe(42);
    if (stop === 'cancel') await page.evaluate(() => window.tsrsExperiment.cancel());
    expect(await promise).toEqual({ error: expect.stringContaining(stop === 'cancel' ? 'cancelled' : 'timed out') });
    expect(await snapshot(page)).toEqual(before);
    expect(await page.evaluate(() => window.tsrsExperiment.events())).toEqual(['typecheck-started', 'worker-terminated']);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  const [next] = output(await run(page, `text(${check()});`));
  expect(next.projectPassed).toBe(true);
});
async function runWithTimeout(page: Page, code: string, timeoutMs: number) { return page.evaluate(({ code, timeoutMs }) => window.tsrsExperiment.run(code, timeoutMs), { code, timeoutMs }); }

test('concurrent host edit rejects stale overlay application after compiler success', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  await page.route('**/tsrs.wasm', async route => { await gate; await route.continue(); });
  const promise = run(page, `await tools.write_file({path:'src/model.ts',content:'export const value: number = 7;',expectedRevision:0}); text(${check()});`);
  try {
    await expect.poll(() => page.evaluate(() => window.tsrsExperiment.events())).toContain('typecheck-started');
    await page.evaluate(() => window.tsrsExperiment.write('src/model.ts', 'export const value: number = 99;'));
  } finally { release(); }
  expect(await promise).toEqual({ error: expect.stringContaining('Scratch tree changed') });
  expect((await snapshot(page)).files.find(f => f.path === 'src/model.ts')!.content).toContain('99');
});

test('cancels synchronous WASM checking while the page stays responsive and recovers cleanly', async ({ page }) => {
  // Many flat exported declarations avoid relying on a deliberately recursive
  // type or stack overflow to keep the compiler busy long enough to cancel it.
  const extra = Object.fromEntries(Array.from({ length: 20 }, (_, f) => [`src/large${f}.ts`, Array.from({ length: 450 }, (_, i) => `export const v${i}: number = ${i};`).join('\n')]));
  await open(page, fixture(extra));
  const before = await snapshot(page);
  const promise = run(page, `await tools.write_file({path:'src/model.ts',content:'export const value: number = 7;',expectedRevision:0}); text(${check()});`);
  // Wait directly for the phase message, rather than waiting for a browser
  // polling interval that might allow the check to finish on a fast machine.
  await page.waitForFunction(() => window.tsrsExperiment.events().includes('compiler-running'), { polling: 'raf' });
  expect(await page.evaluate(() => { window.tsrsExperiment.cancel(); return 42; })).toBe(42);
  expect(await promise).toEqual({ error: 'Execution cancelled; edits discarded.' });
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.tsrsExperiment.events())).toEqual(['typecheck-started', 'compiler-running', 'worker-terminated']);
  await page.evaluate(state => window.tsrsExperiment.reset(state), fixture());
  expect(output(await run(page, `text(${check()});`))[0].projectPassed).toBe(true);
});

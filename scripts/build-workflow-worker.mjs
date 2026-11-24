import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);
function virtualURL(id, url) {
  return { name: id, setup(build) {
    build.onResolve({ filter: new RegExp(`^${id}$`) }, () => ({ path: id, namespace: id }));
    build.onLoad({ filter: /.*/, namespace: id }, () => ({ contents: `export default ${JSON.stringify(url)}`, loader: 'js' }));
  } };
}
/** Hashed worker and WASM assets prevent stale runtime/worker combinations. */
export async function buildWorkflowWorker(output) {
  await mkdir(output, { recursive: true });
  const wasm = gzipSync(await readFile(require.resolve('quickjs-wasi/quickjs.wasm')));
  const wasmName = `workflow-quickjs-${createHash('sha256').update(wasm).digest('hex').slice(0, 16)}.wasm.gz`;
  await writeFile(`${output}/${wasmName}`, wasm);
  const worker = await build({ entryPoints: ['hosted/workflow-worker.ts'], outdir: output, entryNames: 'workflow-worker-[hash]', bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'safari16.4'], minify: true, metafile: true, plugins: [virtualURL('virtual:quickjs-url', `./${wasmName}`)] });
  const file = Object.entries(worker.metafile.outputs).find(([, value]) => value.entryPoint === 'hosted/workflow-worker.ts');
  if (!file) throw Error('Workflow worker output missing.');
  return { define: { WORKFLOW_WORKER_URL: JSON.stringify(`./${basename(file[0])}`) }, metafile: worker.metafile };
}

import { InlineCodemodeSandbox } from '@earendil-works/pi-codemode/portable';
import wasmUrl from 'virtual:quickjs-url';
import { workflowTools } from '../src/workflow-interface';
import { z } from 'zod';

let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
self.addEventListener('message', async (event: MessageEvent) => {
  if (event.data.kind === 'reply') {
    const call = pending.get(event.data.id);
    if (call) { pending.delete(event.data.id); if (event.data.error) call.reject(Error(event.data.error)); else call.resolve(event.data.value); }
    return;
  }
  if (event.data.kind !== 'execute') return;
  let sandbox: InlineCodemodeSandbox | undefined;
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok || !response.body) throw Error('QuickJS WASM unavailable.');
    const wasm = await WebAssembly.compile(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    sandbox = new InlineCodemodeSandbox({ wasm, timeoutMs: 60_000, interruptBudget: 20_000, memoryLimitBytes: 32 * 1024 * 1024,
      tools: workflowTools.map(({ name, description, schema }) => ({ name, description, inputSchema: z.toJSONSchema(schema), execute: args => {
        const input = schema.parse(args);
        return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); self.postMessage({ kind: 'call', id, name, input }); });
      } })) });
    self.postMessage({ result: await sandbox.execute(event.data.code) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Workflow codemode failed.' }); }
  finally { await sandbox?.close(); }
});

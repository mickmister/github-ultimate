import { InlineCodemodeSandbox } from '@earendil-works/pi-codemode/portable';
import wasmUrl from 'virtual:quickjs-url';
import { Scratch, type ScratchState, type ScratchEntry } from '../src/scratch';
import { scratchTools } from './scratch-tools';

let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
function load<T>(method: 'tree' | 'blob', oid: string): Promise<T> { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve: value => resolve(value as T), reject }); self.postMessage({ kind: 'load', id, method, oid }); }); }
self.addEventListener('message', async (event: MessageEvent) => {
  if (event.data.kind === 'loaded') { const call = pending.get(event.data.id); if (call) { pending.delete(event.data.id); if (event.data.error) call.reject(Error(event.data.error)); else call.resolve(event.data.value); } return; }
  if (event.data.kind !== 'execute') return;
  let sandbox: InlineCodemodeSandbox | undefined;
  try {
    const scratch = new Scratch(event.data.state, { tree: oid => load<ScratchEntry[]>('tree', oid), blob: oid => load<string>('blob', oid) });
    const response = await fetch(wasmUrl);
    if (!response.ok) throw Error('QuickJS WASM could not be loaded.');
    if (!response.body) throw Error('QuickJS WASM response is empty.');
    const wasm = await WebAssembly.compile(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    sandbox = new InlineCodemodeSandbox({ wasm, tools: scratchTools(scratch), timeoutMs: 60_000, interruptBudget: 20_000, memoryLimitBytes: 32 * 1024 * 1024 });
    const result = await sandbox.execute(event.data.code);
    self.postMessage({ result, ...(result.ok ? { state: scratch.snapshot() } : {}) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Scratch execution failed.' }); }
  finally { await sandbox?.close(); }
});

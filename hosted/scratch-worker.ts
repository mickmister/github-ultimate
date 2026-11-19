import { InlineCodemodeSandbox } from '@earendil-works/pi-codemode/portable';
import wasmUrl from 'virtual:quickjs-url';
import { Scratch, type ScratchState } from '../src/scratch';
import { scratchTools } from './scratch-tools';

self.addEventListener('message', async (event: MessageEvent<{ code: string; state: ScratchState }>) => {
  let sandbox: InlineCodemodeSandbox | undefined;
  try {
    const scratch = new Scratch(event.data.state);
    const response = await fetch(wasmUrl);
    if (!response.ok) throw Error('QuickJS WASM could not be loaded.');
    if (!response.body) throw Error('QuickJS WASM response is empty.');
    const wasm = await WebAssembly.compile(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    sandbox = new InlineCodemodeSandbox({ wasm, tools: scratchTools(scratch), timeoutMs: 10_000, interruptBudget: 20_000, memoryLimitBytes: 32 * 1024 * 1024 });
    const result = await sandbox.execute(event.data.code);
    self.postMessage({ result, ...(result.ok ? { state: scratch.snapshot() } : {}) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Scratch execution failed.' }); }
  finally { await sandbox?.close(); }
});

import { InlineCodemodeSandbox } from '@earendil-works/pi-codemode/portable';
import { Scratch, type ScratchState } from '../../src/scratch';
import { scratchTools } from '../../hosted/scratch-tools';
import { typeCheckTool } from './type-check';

self.addEventListener('message', async ({ data }: MessageEvent<{ state: ScratchState; code: string }>) => {
  let sandbox: InlineCodemodeSandbox | undefined;
  try {
    const scratch = new Scratch(data.state);
    const response = await fetch(new URL('./quickjs.wasm', import.meta.url));
    if (!response.ok) throw Error('QuickJS WASM unavailable.');
    const wasm = await WebAssembly.compile(await response.arrayBuffer());
    sandbox = new InlineCodemodeSandbox({
      wasm, tools: [...scratchTools(scratch), typeCheckTool(scratch, kind => self.postMessage({ kind }))],
      timeoutMs: 30_000, interruptBudget: 20_000, memoryLimitBytes: 32 * 1024 * 1024,
    });
    const result = await sandbox.execute(data.code);
    self.postMessage({ result, ...(result.ok ? { state: scratch.snapshot() } : {}) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { await sandbox?.close(); }
});

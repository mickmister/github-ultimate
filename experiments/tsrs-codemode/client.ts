import type { CodemodeResult } from '@earendil-works/pi-codemode/portable';
import { Scratch, type ScratchState } from '../../src/scratch';

let scratch = new Scratch(), cancel: (() => void) | undefined;
const events: string[] = [];
const api = {
  reset(state: ScratchState) { if (cancel) throw Error('Execution in progress.'); scratch = new Scratch(state); events.length = 0; },
  snapshot() { return scratch.snapshot(); },
  write(path: string, content: string) { return scratch.write(path, content, scratch.revision); },
  events() { return [...events]; },
  cancel() { cancel?.(); },
  async run(code: string, timeoutMs = 45_000): Promise<{ result?: CodemodeResult; error?: string }> {
    if (cancel) throw Error('Execution in progress.');
    if (code.length > 32 * 1024) throw Error('Script exceeds 32 KiB.');
    const revision = scratch.revision;
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return new Promise(resolve => {
      let closed = false;
      const finish = (value: { result?: CodemodeResult; error?: string }) => {
        if (closed) return;
        closed = true; clearTimeout(timer); worker.terminate(); cancel = undefined;
        events.push('worker-terminated'); resolve(value);
      };
      cancel = () => finish({ error: 'Execution cancelled; edits discarded.' });
      const timer = setTimeout(() => finish({ error: 'Execution timed out; edits discarded.' }), timeoutMs);
      worker.onerror = event => finish({ error: event.message });
      worker.onmessage = ({ data }) => {
        if (closed) return;
        if (data.kind === 'typecheck-started' || data.kind === 'compiler-running') { events.push(data.kind); return; }
        try {
          if (data.error) throw Error(data.error);
          if (data.result.ok) {
            if (!data.state) throw Error('Missing scratch overlay.');
            scratch.applyOverlay(new Scratch(data.state), revision);
          }
          finish({ result: data.result });
        } catch (error) { finish({ error: error instanceof Error ? error.message : String(error) }); }
      };
      worker.postMessage({ state: scratch.snapshot(), code });
    });
  },
};
declare global { interface Window { tsrsExperiment: typeof api } }
window.tsrsExperiment = api;

import type { CodemodeResult } from '@earendil-works/pi-codemode/portable';
import { Scratch, type ScratchState } from '../src/scratch';

export async function executeScratch(scratch: Scratch, code: string, signal?: AbortSignal): Promise<CodemodeResult> {
  if (code.length > 32 * 1024) throw Error('Script exceeds 32 KiB.');
  signal?.throwIfAborted();
  const revision = scratch.revision;
  const worker = new Worker(new URL('./scratch-worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
      const abort = () => { done(); reject(Error('Scratch execution cancelled; edits discarded.')); };
      const timer = setTimeout(() => { done(); reject(Error('Scratch execution timed out; edits discarded.')); }, 15_000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = () => { done(); reject(Error('Scratch worker failed; edits discarded.')); };
      worker.onmessage = (event: MessageEvent<{ error?: string; result: CodemodeResult; state?: ScratchState }>) => {
        done();
        try { signal?.throwIfAborted(); if (event.data.error) throw Error(event.data.error); if (event.data.result.ok) { if (!event.data.state) throw Error('Missing scratch overlay.'); scratch.applyOverlay(new Scratch(event.data.state), revision); } resolve(event.data.result); }
        catch (error) { reject(error); }
      };
      worker.postMessage({ code, state: scratch.snapshot() });
    });
  } finally { worker.terminate(); }
}

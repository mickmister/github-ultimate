import type { CodemodeResult } from '@earendil-works/pi-codemode/portable';
import { Scratch, type ScratchState } from '../src/scratch';

export async function executeScratch(scratch: Scratch, code: string, signal?: AbortSignal): Promise<CodemodeResult> {
  if (code.length > 32 * 1024) throw Error('Script exceeds 32 KiB.');
  signal?.throwIfAborted();
  const revision = scratch.revision;
  const worker = new Worker(new URL('./scratch-worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      let closed = false, loads = 0;
      const done = () => { closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
      const abort = () => { done(); reject(Error('Scratch execution cancelled; edits discarded.')); };
      const timer = setTimeout(() => { done(); reject(Error('Scratch execution timed out; edits discarded.')); }, 90_000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = () => { done(); reject(Error('Scratch worker failed; edits discarded.')); };
      worker.onmessage = async (event: MessageEvent<{ kind?: string; id?: number; method?: 'tree' | 'blob'; oid?: string; error?: string; result: CodemodeResult; state?: ScratchState }>) => {
        if (closed) return;
        if (event.data.kind === 'load') {
          const { id, method, oid } = event.data;
          try {
            if (++loads > 150 || !scratch.loader || !['tree', 'blob'].includes(method ?? '') || !/^[a-f0-9]{40}$/.test(oid ?? '')) throw Error('Workspace read limit exceeded or GitHub is unavailable.');
            const value = await scratch.loader[method!](oid!);
            if (!closed) worker.postMessage({ kind: 'loaded', id, value });
          } catch (error) { if (!closed) worker.postMessage({ kind: 'loaded', id, error: error instanceof Error ? error.message : 'Workspace read failed.' }); }
          return;
        }
        done();
        try { signal?.throwIfAborted(); if (event.data.error) throw Error(event.data.error); if (event.data.result.ok) { if (!event.data.state) throw Error('Missing scratch overlay.'); scratch.applyOverlay(new Scratch(event.data.state), revision); } resolve(event.data.result); }
        catch (error) { reject(error); }
      };
      worker.postMessage({ kind: 'execute', code, state: scratch.snapshot() });
    });
  } finally { worker.terminate(); }
}

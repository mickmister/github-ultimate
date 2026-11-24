import type { CodemodeResult } from '@earendil-works/pi-codemode/portable';
import { workflowTools } from '../src/workflow-interface';
declare const WORKFLOW_WORKER_URL: string;

/** Workflow effects are durable external effects, never scratch transactions. */
export async function executeWorkflowCode(code: string, call: (name: string, input: unknown) => Promise<unknown>, signal?: AbortSignal): Promise<CodemodeResult> {
  if (code.length > 32 * 1024) throw Error('Script exceeds 32 KiB.');
  signal?.throwIfAborted();
  const worker = new Worker(typeof WORKFLOW_WORKER_URL === 'undefined' ? new URL('./workflow-worker.ts', import.meta.url) : new URL(WORKFLOW_WORKER_URL, import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      let closed = false, calls = 0;
      const done = () => { closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
      const abort = () => { done(); reject(Error('Workflow codemode cancelled. Any attempted launch may still be running; inspect its existing identity.')); };
      const timer = setTimeout(abort, 90_000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = () => { done(); reject(Error('Workflow worker failed. Inspect attempted launches; do not replay.')); };
      worker.onmessage = async event => {
        if (closed) return;
        if (event.data.kind === 'call') {
          try {
            const tool = workflowTools.find(tool => tool.name === event.data.name);
            if (++calls > 30 || !tool) throw Error('Workflow capability or call budget exceeded.');
            signal?.throwIfAborted(); const input = tool.schema.parse(event.data.input);
            const value = tool.outputSchema.parse(await call(tool.name, input));
            if (!closed) worker.postMessage({ kind: 'reply', id: event.data.id, value });
          } catch (error) { if (!closed) worker.postMessage({ kind: 'reply', id: event.data.id, error: error instanceof Error ? error.message : 'Workflow capability failed.' }); }
          return;
        }
        done(); if (event.data.error) reject(Error(event.data.error)); else resolve(event.data.result);
      };
      worker.postMessage({ kind: 'execute', code });
    });
  } finally { worker.terminate(); }
}

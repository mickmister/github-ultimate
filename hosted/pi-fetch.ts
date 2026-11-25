import type { InferenceHTTPChunk, InferenceHTTPResponse, PublicInferenceConnection } from '../src/inference-protocol';
import type { PiBridge } from './pi-transport';

/** Fetch transport for Pi's provider SDK. The synthetic URL/key never leave the
 * page: the host selects the actual destination, model and credential headers.
 * Pulling one chunk per RPC works with extension and bounded native transfers. */
export function inferenceFetch(bridge: PiBridge, connection: PublicInferenceConnection): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const path = connection.protocol === 'openai-codex-responses' ? '/codex/responses' : '/chat/completions';
    if (request.url !== `https://extension.invalid${path}` || request.method !== 'POST') throw Error('Unsupported inference transport request.');
    request.signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const identity = { id: connection.id, revision: connection.revision, requestId };
    let closed = false;
    const cancel = async () => {
      if (closed) return;
      closed = true; request.signal.removeEventListener('abort', abort);
      await bridge({ operation: 'inferenceCancel', ...identity }).catch(() => {});
    };
    const abort = () => { void cancel(); };
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await bridge<InferenceHTTPResponse>({ operation: 'inferenceOpen', ...identity, body: await request.text() }, 100000);
      request.signal.throwIfAborted();
      if (response.body !== undefined) {
        closed = true; request.signal.removeEventListener('abort', abort);
        return new Response(response.body, { status: response.status, headers: response.headers });
      }
      let sequence = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            request.signal.throwIfAborted();
            const part = await bridge<InferenceHTTPChunk>({ operation: 'inferenceRead', ...identity, sequence: sequence++ }, 100000);
            request.signal.throwIfAborted();
            if (part.text) controller.enqueue(new TextEncoder().encode(part.text));
            if (part.done) { closed = true; request.signal.removeEventListener('abort', abort); controller.close(); }
          } catch (error) { await cancel(); controller.error(error); }
        },
        cancel,
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) { await cancel(); throw error; }
  };
}

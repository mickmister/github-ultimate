import type { HostedRequest } from './hosted-protocol';
import { mobilePiMethod, mobilePiMaxBytes, splitPiText } from './mobile-pi-protocol';
import { utf8Bytes } from './utf8';
type NativeRPC = { request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> };
export async function mobilePiRequest<T>(client: NativeRPC, request: HostedRequest, timeoutMs: number): Promise<T> {
  const text = JSON.stringify(request), bytes = utf8Bytes(text), transferId = crypto.randomUUID(), deadline = Date.now() + timeoutMs;
  if (bytes > mobilePiMaxBytes) throw Error('Native Pi request exceeded the transfer limit.');
  const call = (params: Record<string, unknown>) => {
    const remaining = deadline - Date.now(); if (remaining <= 0) throw Error('Native Pi request timed out; retry explicitly.');
    return client.request(mobilePiMethod, { ...params, transferId }, remaining);
  };
  try {
    await call({ phase: 'begin', bytes });
    const parts = splitPiText(text);
    for (let index = 0; index < parts.length; index++) await call({ phase: 'chunk', index, text: parts[index] });
    const response = await call({ phase: 'commit' }) as { chunks: number; bytes: number };
    if (!Number.isInteger(response.chunks) || response.chunks < 1 || response.chunks > 8192 || !Number.isInteger(response.bytes) || response.bytes < 1 || response.bytes > mobilePiMaxBytes) throw Error('Invalid native Pi response.');
    let result = '';
    for (let index = 0; index < response.chunks; index++) {
      const chunk = await call({ phase: 'read', index }) as { text: string };
      if (typeof chunk.text !== 'string' || chunk.text.length > 2000 || result.length + chunk.text.length > mobilePiMaxBytes) throw Error('Invalid native Pi response chunk.');
      result += chunk.text;
    }
    if (utf8Bytes(result) !== response.bytes) throw Error('Native Pi response size mismatch.');
    return JSON.parse(result) as T;
  } finally { await client.request(mobilePiMethod, { phase: 'cancel', transferId }, 1000).catch(() => {}); }
}

import type { HostedRequest } from './hosted-protocol';
import { maxMobileReviewBytes, mobileReviewChunkChars, mobileReviewTransferMethod } from './mobile-transfer-protocol';
import { utf8Bytes } from './utf8';

type NativeRPC = { request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> };
/** Leave the compiled native ingress limit unchanged, including JSON escaping overhead. */
export async function mobileGitHubRequest<T>(client: NativeRPC, request: HostedRequest, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const call = (method: string, params: Record<string, unknown>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Native review request timed out; retry explicitly.');
    return client.request(method, params, remaining);
  };
  if (request.operation !== 'reviewWrite' || utf8Bytes(JSON.stringify(request)) <= 14000) return await call('github.request', request) as T;
  const { text, ...metadata } = request;
  const bytes = utf8Bytes(text);
  if (!bytes || bytes > maxMobileReviewBytes) throw new Error('Review artifact exceeds 256 KB.');
  const transferId = crypto.randomUUID();
  let finished = false;
  try {
    await call(mobileReviewTransferMethod, { phase: 'begin', transferId, bytes, request: metadata });
    let index = 0;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + mobileReviewChunkChars, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      await call(mobileReviewTransferMethod, { phase: 'chunk', transferId, index: index++, text: text.slice(offset, end) });
      offset = end;
    }
    const result = await call(mobileReviewTransferMethod, { phase: 'commit', transferId });
    finished = true; return result as T;
  } finally {
    if (!finished) await client.request(mobileReviewTransferMethod, { phase: 'cancel', transferId }, 1000).catch(() => {});
  }
}

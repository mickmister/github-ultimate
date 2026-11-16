export type ProbeReply = { outcome: 'result' | 'denied' | 'silent' | 'absent'; detail: string };
type Endpoint = { postMessage(value: unknown): unknown; onmessage?: (event: { data: string }) => void };

/** Raw native endpoints, deliberately independent of the main-frame-only bootstrap. */
export async function rawProbe(data: string | ArrayBuffer, timeoutMs = 1200): Promise<ProbeReply> {
  const host = window as unknown as { webkit?: { messageHandlers?: { alohak?: Endpoint } }; alohak?: Endpoint; alohakNative?: unknown };
  const ios = host.webkit?.messageHandlers?.alohak, android = host.alohak;
  if (!ios && !android) return { outcome: 'absent', detail: 'Raw native endpoint is absent in this document.' };
  let id: unknown = null;
  try { if (typeof data === 'string') id = JSON.parse(data).id ?? null; } catch { /* Malformed-input probe. */ }
  return new Promise(resolve => {
    let finished = false;
    const previous = android?.onmessage;
    const finish = (reply: ProbeReply) => {
      if (finished) return; finished = true; clearTimeout(timer);
      window.removeEventListener('alohak-native-message', receive);
      if (android && !host.alohakNative) android.onmessage = previous;
      resolve(reply);
    };
    const decode = (raw: unknown) => {
      try {
        if (typeof raw !== 'string') return;
        const reply = JSON.parse(raw);
        if (reply.jsonrpc !== '2.0' || reply.id !== id && !(reply.id === null && reply.error)) return;
        finish({ outcome: reply.error ? 'denied' : 'result', detail: reply.error?.message ?? 'Native method returned a result.' });
      } catch { /* An unrelated or malformed response is not a successful probe. */ }
    };
    const receive = (event: Event) => decode((event as CustomEvent).detail);
    const timer = setTimeout(() => finish({ outcome: 'silent', detail: `No matching reply within ${timeoutMs} ms; this alone is not proof of denial.` }), timeoutMs);
    window.addEventListener('alohak-native-message', receive);
    try {
      if (ios) Promise.resolve(ios.postMessage(data)).then(decode, () => finish({ outcome: 'denied', detail: 'Native endpoint rejected the message.' }));
      else {
        if (!host.alohakNative) android!.onmessage = event => decode(event.data);
        android!.postMessage(data);
      }
    } catch { finish({ outcome: 'denied', detail: 'Native endpoint rejected the value type.' }); }
  });
}

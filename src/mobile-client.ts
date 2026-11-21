import { mobileProtocol, type MobileReply } from './mobile-protocol';

declare global {
  interface Window {
    alohakNative?: { protocolVersion: number; documentId: string; postMessage(data: string): void };
    alohakReceive?: (documentId: string, data: string) => void;
  }
}

let requestSequence = 0;
/** Small JSON-RPC adapter; existing extension clients retain their wire format. */
export class MobileClient {
  private closed = false;
  private pending = new Map<string, { documentId: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private page: Window = window) {
    page.addEventListener('alohak-native-message', this.receive);
    page.addEventListener('pagehide', this.close);
  }
  request(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    const transport = this.page.alohakNative;
    if (this.closed) return Promise.reject(new Error('Native client closed.'));
    if (!transport || transport.protocolVersion !== mobileProtocol) return Promise.reject(new Error('Native bridge is not ready or compatible.'));
    if (this.pending.size >= 8) return Promise.reject(new Error('Too many pending native requests.'));
    const id = `mobile_${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Native request timed out; reconnect explicitly.')); }, timeoutMs);
      this.pending.set(id, { documentId: transport.documentId, resolve, reject, timer });
      try { transport.postMessage(JSON.stringify({ jsonrpc: '2.0', id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Native transport failed.')); }
    });
  }
  private receive = (event: Event) => {
    try {
      const reply = JSON.parse((event as CustomEvent<string>).detail) as MobileReply;
      if (reply.jsonrpc !== '2.0' || typeof reply.id !== 'string') return;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (pending.documentId !== this.page.alohakNative?.documentId) pending.reject(new Error('Document changed.'));
      else if (reply.error) pending.reject(new Error(reply.error.message));
      else pending.resolve(reply.result);
    } catch { /* Ignore malformed replies; bounded timeout handles a broken peer. */ }
  };
  close = () => {
    this.closed = true;
    this.page.removeEventListener('alohak-native-message', this.receive);
    this.page.removeEventListener('pagehide', this.close);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Native client closed.')); }
    this.pending.clear();
  };
}

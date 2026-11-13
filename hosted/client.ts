import { pageChannel, replyChannel, hostedRelayRevision } from '../src/bridge-channels';
import type { HostedRequest } from '../src/hosted-protocol';
import { MobileClient } from '../src/mobile-client';

async function nativeRequest<T>(request: HostedRequest, timeoutMs: number): Promise<T> {
  const started = Date.now();
  if (!window.alohakNative) await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('alohak-native-ready', ready); };
    const ready = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Alohak bridge did not become ready. Reload from native settings.')); }, timeoutMs);
    window.addEventListener('alohak-native-ready', ready);
    if (window.alohakNative) ready();
  });
  const client = new MobileClient();
  try { return await client.request('github.request', request, Math.max(1, timeoutMs - (Date.now() - started))) as T; }
  finally { client.close(); }
}

export function bridgeRequest<T>(request: HostedRequest, timeoutMs = 30000): Promise<T> {
  if (!window.isSecureContext) return Promise.reject(new Error('Open this page over HTTPS (or HTTP localhost for development).'));
  // A UA marker selects transport only, never authority. Await the native
  // bootstrap rather than accidentally trying the extension during page load.
  if (window.alohakNative || /Alohak\/1/.test(navigator.userAgent)) return nativeRequest<T>(request, timeoutMs);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || !message || message.channel !== replyChannel || message.version !== 1 || message.requestId !== requestId || typeof message.ok !== 'boolean') return;
      cleanup();
      if (message.relayRevision !== hostedRelayRevision) { reject(new Error('The hosted extension relay is outdated. Update the extension, then reload this page to replace its injected script.')); return; }
      if (message.ok) resolve(message.result as T);
      else reject(new Error(typeof message.error === 'string' ? message.error : 'Extension request failed.'));
    };
    const timeout = setTimeout(() => {
      cleanup(); reject(new Error('No bridge response. Update/enable the extension, approve this origin in connection settings, reload this page and retry.'));
    }, timeoutMs);
    window.addEventListener('message', receive);
    window.postMessage({ channel: pageChannel, version: 1, requestId, request }, location.origin);
  });
}

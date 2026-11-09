import { pageChannel, replyChannel, type HostedRequest } from '../src/hosted-protocol';

export function bridgeRequest<T>(request: HostedRequest, timeoutMs = 30000): Promise<T> {
  if (!window.isSecureContext) return Promise.reject(new Error('Open this page over HTTPS (or HTTP localhost for development).'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || !message || message.channel !== replyChannel || message.version !== 1 || message.requestId !== requestId || typeof message.ok !== 'boolean') return;
      cleanup();
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

import { pageMessageSchema, replyChannel } from './hosted-protocol';
import { extensionAPI } from './extension-api';

// Registered only for user-approved exact origins. Authorization is rechecked
// in the broker on every request; an already injected script grants no access.
if (window.top === window) {
  let pending = 0;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = pageMessageSchema.safeParse(event.data);
    if (!message.success || pending >= 8) return;
    pending++;
    void extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-hosted-v1', request: message.data.request }).then(
      response => window.postMessage({ channel: replyChannel, version: 1, requestId: message.data.requestId, ...(response ?? { ok: false, error: 'Extension broker unavailable.' }) }, location.origin),
      () => window.postMessage({ channel: replyChannel, version: 1, requestId: message.data.requestId, ok: false, error: 'Reload this page after updating the extension.' }, location.origin),
    ).finally(() => pending--);
  });
}

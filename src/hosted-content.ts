import { pageEnvelopeSchema, hostedRequestSchema, replyChannel } from './hosted-protocol';
import { hostedRelayRevision } from './bridge-channels';
import { extensionAPI } from './extension-api';

// Registered only for user-approved exact origins. Authorization is rechecked
// in the broker on every request; an already injected script grants no access.
if (window.top === window) {
  // This must run synchronously at document_start, before page scripts, not on
  // first request. History API navigation never changes this document identity.
  const documentURL = location.href;
  const documentOrigin = location.origin;
  let pending = 0;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== documentOrigin) return;
    if (event.data?.channel === 'github-ultimate-storage-probe-v1' && typeof event.data.requestId === 'string' && event.data.requestId.length <= 80) {
      // Availability only, never authorization. Every storage operation still
      // checks the captured original document and current independent grant.
      window.postMessage({ channel: 'github-ultimate-storage-present-v1', requestId: event.data.requestId }, documentOrigin);
      return;
    }
    const message = pageEnvelopeSchema.safeParse(event.data);
    if (!message.success) return;
    const reply = (response: object) => window.postMessage({ channel: replyChannel, version: 1, relayRevision: hostedRelayRevision, requestId: message.data.requestId, ...response }, location.origin);
    const request = hostedRequestSchema.safeParse(message.data.request);
    if (!request.success) { reply({ ok: false, error: 'Hosted request is incompatible with this extension. Update the extension and reload this page.' }); return; }
    if (pending >= 8) { reply({ ok: false, error: 'Too many pending extension reads. Wait for the current request to finish.' }); return; }
    pending++;
    void Promise.resolve().then(() => extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-hosted-v1', relayRevision: hostedRelayRevision, documentURL, request: request.data })).then(
      response => reply(response ?? { ok: false, error: 'Extension broker unavailable.' }),
      () => reply({ ok: false, error: 'Reload this page after updating the extension.' }),
    ).finally(() => pending--);
  });
}

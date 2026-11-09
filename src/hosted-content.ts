import { pageEnvelopeSchema, hostedRequestSchema, replyChannel } from './hosted-protocol';
import { hostedRelayRevision } from './bridge-channels';
import { extensionAPI } from './extension-api';

// Registered only for user-approved exact origins. Authorization is rechecked
// in the broker on every request; an already injected script grants no access.
if (window.top === window) {
  let pending = 0;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = pageEnvelopeSchema.safeParse(event.data);
    if (!message.success) return;
    const reply = (response: object) => window.postMessage({ channel: replyChannel, version: 1, relayRevision: hostedRelayRevision, requestId: message.data.requestId, ...response }, location.origin);
    const request = hostedRequestSchema.safeParse(message.data.request);
    if (!request.success) { reply({ ok: false, error: 'Hosted request is incompatible with this extension. Update the extension and reload this page.' }); return; }
    if (pending >= 8) { reply({ ok: false, error: 'Too many pending extension reads. Wait for the current request to finish.' }); return; }
    pending++;
    void Promise.resolve().then(() => extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-hosted-v1', request: request.data })).then(
      response => reply(response ?? { ok: false, error: 'Extension broker unavailable.' }),
      () => reply({ ok: false, error: 'Reload this page after updating the extension.' }),
    ).finally(() => pending--);
  });
}

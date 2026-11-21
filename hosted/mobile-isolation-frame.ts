import { rawProbe } from './isolation-transport';
import './mobile-proof.css';

const params = new URLSearchParams(location.search);
const nonce = params.get('nonce') ?? document.documentElement.dataset.nonce ?? '';
// This fixture intentionally bypasses alohakNative and calls the raw frame endpoint.
void rawProbe(JSON.stringify({ jsonrpc: '2.0', id: `frame_${crypto.randomUUID()}`, method: 'fixture.echo', params: { text: 'frame-probe' } })).then(reply => {
  document.body.textContent = JSON.stringify(reply);
  parent.postMessage({ channel: 'alohak-isolation-frame-v1', nonce, reply }, '*');
});

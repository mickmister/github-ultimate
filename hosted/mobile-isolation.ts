import { MobileClient } from '../src/mobile-client';
import { rawProbe, type ProbeReply } from './isolation-transport';
import './mobile-proof.css';
import './mobile-isolation.css';

declare const __HOSTED_BUILD__: { branch: string; sha: string };
type Result = { name: string; status: 'pass' | 'fail' | 'inconclusive'; detail: string };
const results: Result[] = [];
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const loadId = crypto.randomUUID(), startedAt = new Date().toISOString();
let running = false;
function record(name: string, status: Result['status'], detail: string) {
  results.push({ name, status, detail });
  document.getElementById('results')!.textContent = JSON.stringify(results, null, 2);
}
function ready() { document.getElementById('native-status')!.textContent = window.alohakNative ? `Native document ${window.alohakNative.documentId}; page load ${loadId}` : 'No native bootstrap yet. Open this page in Alohak.'; }
window.addEventListener('alohak-native-ready', ready); ready();
window.addEventListener('alohak-native-message', event => {
  try {
    const reply = JSON.parse((event as CustomEvent<string>).detail), marker = reply.result?.text;
    if (typeof marker === 'string' && /^[a-f0-9-]{36}_[a-f0-9-]{36}$/.test(marker) && !marker.startsWith(`${loadId}_`)) {
      record('foreign lifecycle reply', 'fail', `A lifecycle marker from another page load arrived: ${marker}; current load ${loadId}.`);
    }
  } catch { /* Malformed traffic is exercised separately. */ }
});
async function rpc(method: string, params: Record<string, unknown>, timeout = 3000) {
  const client = new MobileClient();
  try { return await client.request(method, params, timeout); } finally { client.close(); }
}
const textMatches = (value: unknown, text: string) => (value as { text?: string })?.text === text;
function negative(name: string, reply: ProbeReply, allowAbsent = false) {
  record(name, reply.outcome === 'result' ? 'fail' : reply.outcome === 'denied' || allowAbsent && reply.outcome === 'absent' ? 'pass' : 'inconclusive', reply.detail);
}
async function frameProbe(name: string, configure: (frame: HTMLIFrameElement, nonce: string) => void) {
  const frame = document.createElement('iframe'), nonce = crypto.randomUUID(); frame.title = name;
  const reply = await new Promise<ProbeReply>(resolve => {
    const finish = (value: ProbeReply) => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(value); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== 'alohak-isolation-frame-v1' || event.data.nonce !== nonce) return;
      const reply = event.data.reply;
      if (!reply || !['result', 'denied', 'silent', 'absent'].includes(reply.outcome) || typeof reply.detail !== 'string') return;
      finish(reply);
    };
    const timer = setTimeout(() => finish({ outcome: 'silent', detail: 'Frame did not report. Check its load/CSP before treating this as a denial.' }), 5000);
    window.addEventListener('message', receive); configure(frame, nonce); document.getElementById('frames')!.append(frame);
  });
  frame.remove(); negative(name, reply, true);
}
async function automatic() {
  if (!window.alohakNative) throw new Error('Native bridge missing; no native test was run.');
  const discovery = await rpc('alohak.discover', { protocolVersion: 1 }) as { capabilities?: string[] };
  record('approved main-frame control', textMatches(await rpc('fixture.echo', { text: 'control' }), 'control') ? 'pass' : 'fail', 'Approved top-level echo must work before negative probes.');
  const delayed = discovery.capabilities?.includes('fixture.delay');
  if (delayed) {
    const order: string[] = [];
    const values = await Promise.all([['slow', 400], ['fast', 20], ['middle', 150]].map(async ([text, delayMs]) => {
      const result = await rpc('fixture.delay', { text, delayMs }); order.push(String(text)); return textMatches(result, String(text));
    }));
    record('concurrent out-of-order replies', values.every(Boolean) && order.join(',') === 'fast,middle,slow' ? 'pass' : 'fail', `Completion order: ${order.join(',')}; values must match their requests.`);
  } else record('delayed-reply capability', 'inconclusive', 'Update the bundled Alohak app: fixture.delay is unavailable.');
  const original = location.href;
  try {
    history.replaceState(null, '', '../mobile-proof.html#isolation-history');
    record('approved document retains original authority after History rewrite', textMatches(await rpc('fixture.echo', { text: 'history' }), 'history') ? 'pass' : 'fail', 'Positive original-document control, NOT an unapproved-document promotion test.');
  } finally { history.replaceState(null, '', original); }
  await frameProbe('same-origin frame', (frame, nonce) => { frame.src = `frame.html?nonce=${nonce}`; });
  const response = await fetch('frame.html'); if (!response.ok) throw new Error('Frame fixture failed to load.');
  const html = await response.text(), base = new URL('.', original).href;
  const source = (nonce: string) => html.replace('<html ', `<html data-nonce="${nonce}" `).replace('<head>', `<head><base href="${base}">`);
  await frameProbe('srcdoc frame', (frame, nonce) => { frame.srcdoc = source(nonce); });
  await frameProbe('sandboxed opaque-origin frame', (frame, nonce) => { frame.sandbox.add('allow-scripts'); frame.srcdoc = source(nonce); });
  await frameProbe('nested frame', (frame, nonce) => {
    // The outer fixture relays only its own child; the top page still checks source + nonce.
    frame.srcdoc = `<iframe src="${base}frame.html?nonce=${nonce}"></iframe><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow)parent.postMessage(e.data,'*')})<\/script>`;
  });
  const cross = field('cross-origin').value;
  if (cross) {
    const url = new URL(cross);
    if (url.protocol !== 'https:' || url.origin === location.origin || url.username || url.password) throw new Error('Use an HTTPS fixture on a different origin, without credentials.');
    await frameProbe('different HTTPS-origin frame', (frame, nonce) => { url.searchParams.set('nonce', nonce); frame.src = url.href; });
  } else record('different HTTPS-origin frame', 'inconclusive', 'Requires an independently hosted frame fixture. Opaque sandbox coverage is recorded separately.');
  for (const [name, raw] of [
    ['malformed JSON', '{'],
    ['batch request', '[]'],
    ['forged envelope authority', JSON.stringify({ jsonrpc: '2.0', id: `forged_${crypto.randomUUID()}`, method: 'fixture.echo', params: { text: 'forged' }, documentURL: original })],
  ]) negative(name!, await rawProbe(raw!));
  negative('oversized inbound message', await rawProbe('x'.repeat(17000)));
  negative('binary inbound message', await rawProbe(new Uint8Array([1, 2, 3]).buffer));
  const stock = (window as unknown as { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
  record('stock ReactNativeWebView endpoint', stock ? 'inconclusive' : 'pass', stock ? 'Unexpected stock endpoint is present; inspect native configuration before acceptance.' : 'Stock endpoint absent in scoped mode.');
  record('final main-frame control', textMatches(await rpc('fixture.echo', { text: 'final' }), 'final') ? 'pass' : 'fail', 'Bridge still responds after rejected probes.');
  record('remaining device observations', 'inconclusive', 'Unapproved top-level History promotion, popup/redirect and native lifecycle races require the runbook observations; automatic checks do not accept these.');
}
async function delayed(name: string, revoke: boolean) {
  const capability = await rpc('alohak.discover', { protocolVersion: 1 }) as { capabilities?: string[] };
  if (!capability.capabilities?.includes('fixture.delay')) throw new Error('Update Alohak first: fixture.delay is unavailable.');
  const marker = `${loadId}_${crypto.randomUUID()}`;
  document.getElementById('marker')!.textContent = `Pending ${name}: ${marker}; native document ${window.alohakNative?.documentId}. Act within eight seconds.`;
  try {
    const value = await rpc('fixture.delay', { text: marker, delayMs: 8000 }, 12000);
    record(name, revoke ? 'fail' : 'inconclusive', revoke ? 'Delayed request returned a result. If revocation occurred in time, this is a failure.' : `Request completed in this same page: ${textMatches(value, marker)}. No lifecycle action can be inferred.`);
  } catch (error) {
    const message = String(error);
    record(name, revoke && /access or document changed|no native fixture grant/i.test(message) ? 'pass' : 'inconclusive', message);
  }
  document.getElementById('marker')!.textContent = 'Delayed check ended; see report.';
}
for (const [id, action] of [['run', automatic], ['revoke', () => delayed('in-flight fixture revocation', true)], ['pending', () => delayed('lifecycle marker', false)]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    if (running) return; running = true;
    void action().catch(error => record(id, 'inconclusive', String(error))).finally(() => { running = false; });
  });
}
document.getElementById('report')!.addEventListener('click', () => {
  (document.getElementById('output') as HTMLTextAreaElement).value = JSON.stringify({ schemaVersion: 1, hostedBuild: __HOSTED_BUILD__, installedBuild: field('installed').value, device: field('device').value, userAgent: navigator.userAgent, startedAt, loadId, nativeDocumentId: window.alohakNative?.documentId, results, observations: (document.getElementById('observations') as HTMLTextAreaElement).value, acceptance: 'Device evidence only; no automatic overall acceptance or credential enablement.' }, null, 2);
});

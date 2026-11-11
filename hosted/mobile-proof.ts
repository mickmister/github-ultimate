import { MobileClient } from '../src/mobile-client';
import { companionLink } from '../src/mobile-protocol';
import './mobile-proof.css';

const handoff = document.getElementById('handoff')!;
const result = document.getElementById('proof-result')!;
const automatic = document.getElementById('automatic-opening') as HTMLInputElement;
const open = document.getElementById('open-app') as HTMLAnchorElement;
const status = document.getElementById('handoff-status')!;
const preference = 'github-ultimate-companion-auto-open-v1';
const entry = new URL('mobile-proof.html', location.href).href;
open.href = companionLink(entry, location.href);
let attempted = false;
let dismissed = false;
const insideCompanion = /GitHubUltimateCompanion\/1/.test(navigator.userAgent);
if (insideCompanion) handoff.hidden = true;
function store(value: boolean) { try { localStorage.setItem(preference, String(value)); } catch { /* Session-only when storage is denied. */ } }
try { automatic.checked = localStorage.getItem(preference) === 'true'; } catch { /* Storage is optional. */ }
automatic.addEventListener('change', () => store(automatic.checked));
document.getElementById('stay-web')!.addEventListener('click', () => { dismissed = true; automatic.checked = false; store(false); handoff.hidden = true; });
open.addEventListener('click', () => { status.textContent = 'Opening requested. If you remain here, check installation and use Open in app again.'; });
function ready() {
  if (window.githubUltimateNative) { handoff.hidden = true; result.textContent = 'Native transport ready. Enable the fixture grant in native settings, then run the proof.'; }
}
window.addEventListener('github-ultimate-native-ready', ready);
ready();
// Delay until a normal page load has had a chance to receive the native
// bootstrap; never loop or infer install/launch success from this timer.
setTimeout(() => {
  if (!insideCompanion && !window.githubUltimateNative && !dismissed && !attempted && automatic.checked && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    attempted = true;
    status.textContent = 'One automatic opening attempt requested; use Open in app if your browser requires a tap.';
    location.href = open.href;
  }
}, 1500);
document.getElementById('run-proof')!.addEventListener('click', async () => {
  const client = new MobileClient();
  try {
    const discovery = await client.request('companion.discover', { protocolVersion: 1 });
    const echo = await client.request('fixture.echo', { text: 'Remote page ↔ installed companion' });
    result.textContent = JSON.stringify({ discovery, echo }, null, 2);
  } catch (error) { result.textContent = error instanceof Error ? error.message : 'Native proof failed.'; }
  finally { client.close(); }
});

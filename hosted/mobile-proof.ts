import { MobileClient } from '../src/mobile-client';
import { alohakLink } from '../src/mobile-protocol';
import './mobile-proof.css';
import { openPageStorage } from './page-storage';

const handoff = document.getElementById('handoff')!;
const result = document.getElementById('proof-result')!;
const automatic = document.getElementById('automatic-opening') as HTMLInputElement;
const open = document.getElementById('open-app') as HTMLAnchorElement;
const status = document.getElementById('handoff-status')!;
const preference = 'alohak-auto-open-v1';
const entry = new URL('mobile-proof.html', location.href).href;
open.href = alohakLink(entry, location.href);
let attempted = false;
let dismissed = false;
const insideAlohak = /Alohak\/1/.test(navigator.userAgent);
if (insideAlohak) handoff.hidden = true;
function store(value: boolean) { try { localStorage.setItem(preference, String(value)); } catch { /* Session-only when storage is denied. */ } }
try { automatic.checked = localStorage.getItem(preference) === 'true'; } catch { /* Storage is optional. */ }
automatic.addEventListener('change', () => store(automatic.checked));
document.getElementById('stay-web')!.addEventListener('click', () => { dismissed = true; automatic.checked = false; store(false); handoff.hidden = true; });
open.addEventListener('click', () => { status.textContent = 'Opening requested. If you remain here, check installation and use Open in app again.'; });
function ready() {
  if (window.alohakNative) { handoff.hidden = true; result.textContent = 'Native transport ready. Enable the fixture grant in native settings, then run the proof.'; }
}
window.addEventListener('alohak-native-ready', ready);
ready();
// Delay until a normal page load has had a chance to receive the native
// bootstrap; never loop or infer install/launch success from this timer.
setTimeout(() => {
  if (!insideAlohak && !window.alohakNative && !dismissed && !attempted && automatic.checked && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    attempted = true;
    status.textContent = 'One automatic opening attempt requested; use Open in app if your browser requires a tap.';
    location.href = open.href;
  }
}, 1500);
document.getElementById('run-proof')!.addEventListener('click', async () => {
  const client = new MobileClient();
  try {
    const discovery = await client.request('alohak.discover', { protocolVersion: 1 });
    const echo = await client.request('fixture.echo', { text: 'Remote page ↔ installed Alohak app' });
    result.textContent = JSON.stringify({ discovery, echo }, null, 2);
  } catch (error) { result.textContent = error instanceof Error ? error.message : 'Native proof failed.'; }
  finally { client.close(); }
});

const storageResult = document.getElementById('storage-result')!;
let pageStorage: Awaited<ReturnType<typeof openPageStorage>> | undefined;
function showStorage() {
  const storage = pageStorage!.storage;
  storageResult.textContent = JSON.stringify(Array.from({ length: storage.length }, (_, index) => { const key = storage.key(index)!; return [key, storage.getItem(key)]; }));
}
function storageAction(id: string, action: () => Promise<void>) {
  document.getElementById(id)!.addEventListener('click', () => { void action().catch(error => { storageResult.textContent = String(error); }); });
}
storageAction('connect-storage', async () => {
  pageStorage?.close(); pageStorage = undefined;
  const mode = (document.getElementById('storage-backend') as HTMLSelectElement).value as 'browser' | 'extension' | 'mobile';
  pageStorage = await openPageStorage(mode, (document.getElementById('storage-override') as HTMLInputElement).checked);
  showStorage();
});
storageAction('save-storage', async () => {
  if (!pageStorage) throw new Error('Open page storage first.');
  pageStorage.storage.setItem((document.getElementById('storage-key') as HTMLInputElement).value, (document.getElementById('storage-value') as HTMLInputElement).value);
  await pageStorage.storage.flush(); showStorage();
});
storageAction('refresh-storage', async () => { if (!pageStorage) throw new Error('Open page storage first.'); await pageStorage.storage.refresh(); showStorage(); });
storageAction('clear-storage', async () => { if (!pageStorage) throw new Error('Open page storage first.'); pageStorage.storage.clear(); await pageStorage.storage.flush(); showStorage(); });

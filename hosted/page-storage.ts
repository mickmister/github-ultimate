import { HydratedPageStorage, overrideLocalStorage, type PageStorageTransport, type PageStorageBackend } from '../src/page-storage';

async function extensionPresent() {
  const requestId = crypto.randomUUID();
  return new Promise<boolean>(resolve => {
    const finish = (present: boolean) => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(present); };
    const receive = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.channel === 'github-ultimate-storage-present-v1' && event.data.requestId === requestId) finish(true);
    };
    const timer = setTimeout(() => finish(false), 250);
    window.addEventListener('message', receive);
    window.postMessage({ channel: 'github-ultimate-storage-probe-v1', requestId }, location.origin);
  });
}
async function nativeReady() {
  if (window.alohakNative || window.githubUltimateStorageAdapter) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('alohak-native-ready', ready); };
    const ready = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Native storage adapter did not become ready. Reload from native settings.')); }, 30000);
    window.addEventListener('alohak-native-ready', ready);
    if (window.alohakNative || window.githubUltimateStorageAdapter) ready();
  });
}

/** Shared SDK selection, not application policy. A denied selected host never falls back. */
export async function openPageStorage(mode: PageStorageBackend | 'auto' = 'auto', replaceLocalStorage = false) {
  if (mode === 'auto') {
    if (/Alohak\/1/.test(navigator.userAgent)) await nativeReady();
    const injected = window.githubUltimateStorageAdapter;
    if (injected && (injected.protocolVersion !== 1 || typeof injected.request !== 'function' || !['mobile', 'extension', 'browser'].includes(injected.backend))) throw new Error('Incompatible injected page-storage adapter.');
    mode = injected?.backend ?? (window.alohakNative ? 'mobile' : await extensionPresent() ? 'extension' : 'browser');
  }
  if (!['browser', 'extension', 'mobile'].includes(mode)) throw new Error('Choose a supported page storage backend explicitly.');
  const originalDocument = location.href;
  let disconnect = () => {};
  let transport: PageStorageTransport;
  const injected = window.githubUltimateStorageAdapter;
  if (injected?.backend === mode) {
    if (injected.protocolVersion !== 1 || typeof injected.request !== 'function') throw new Error('Incompatible injected page-storage adapter.');
    transport = request => injected.request(request);
  }
  else {
    // Hosts may supply the entire adapter. Fallback implementations are separate
    // lazy chunks, never conditional transport code in application components.
    const adapter = mode === 'mobile' ? (await import('./storage/mobile')).storageAdapter()
      : mode === 'extension' ? (await import('./storage/extension')).storageAdapter()
      : (await import('./storage/browser')).storageAdapter(originalDocument);
    transport = adapter.request; disconnect = adapter.close;
  }
  try {
    const storage = await HydratedPageStorage.open(transport, error => window.dispatchEvent(new CustomEvent('page-storage-error', { detail: error.message })));
    const restore = replaceLocalStorage ? overrideLocalStorage(window, storage) : () => storage.close();
    let closed = false;
    return { storage, backend: mode, close: () => { if (!closed) { closed = true; restore(); disconnect(); } } };
  } catch (error) { disconnect(); throw error; }
}

// Safari exposes the promise-based browser namespace; Chromium exposes chrome.
// Keep this lazy so the shared renderer also works in the web playground.
export function extensionAPI(): typeof chrome {
  const api = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? globalThis.chrome;
  if (!api?.storage?.local) throw new Error('Extension storage is unavailable.');
  return api;
}

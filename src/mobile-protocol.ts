// Portable protocol/policy shared by the installed shell and remote proof page.
// M1 deliberately has no credential store, general fetch or GitHub/S3 methods.
import { pageKVBytes, PageKVService, type PageKVStore } from './page-kv';
export const mobileProtocol = 1;
export const companionScheme = 'githubultimate';
export const maxMobileMessageBytes = 16 * 1024;
export type MobileDocument = { documentId: string; documentURL: string };
export type MobileGrant = { origin: string; subpath: string };
export type MobileReply = { jsonrpc: '2.0'; id: string | null; result?: unknown; error?: { code: number; message: string } };

export function deploymentURL(input: string): URL {
  if (!input || input.length > 4096 || /[\s\\]/.test(input) || /%(?:2f|5c|2e|25)/i.test(input.split(/[?#]/)[0])) throw new Error('Use an unambiguous HTTPS URL.');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('Use HTTPS without credentials or a custom port for this pilot.');
  if (input.split(/[?#]/)[0].split('/').some(part => part === '.' || part === '..')) throw new Error('Dot path segments are not supported.');
  return url;
}

export function grantForEntry(input: string): MobileGrant {
  const url = deploymentURL(input);
  return { origin: url.origin, subpath: new URL('.', url).pathname };
}

export function matchesMobileGrant(grant: MobileGrant, input: string): boolean {
  try {
    const url = deploymentURL(input);
    return url.origin === grant.origin && grant.subpath.startsWith('/') && grant.subpath.endsWith('/') &&
      (url.pathname === grant.subpath.slice(0, -1) || url.pathname.startsWith(grant.subpath));
  } catch { return false; }
}

// Custom schemes carry navigation only. The installed deployment is the trust
// anchor; links cannot choose an origin, connection, grant or broker operation.
export function companionLink(entry: string, target: string): string {
  const url = deploymentURL(target);
  if (!matchesMobileGrant(grantForEntry(entry), url.href)) throw new Error('Route is outside the configured deployment.');
  const link = new URL(`${companionScheme}://open`);
  link.searchParams.set('route', url.pathname + url.search + url.hash);
  return link.href;
}

export function resolveCompanionLink(input: string, entry: string): string {
  if (input.length > 8192) throw new Error('Link is too long.');
  const link = new URL(input);
  if (link.protocol !== `${companionScheme}:` || link.hostname !== 'open' || link.port || link.username || link.password ||
      link.pathname && link.pathname !== '/' || link.hash || [...link.searchParams.keys()].some(key => key !== 'route') || link.searchParams.getAll('route').length !== 1) {
    throw new Error('Unsupported companion link.');
  }
  const route = link.searchParams.get('route')!;
  if (!route.startsWith('/') || route.startsWith('//') || /[\s\\]/.test(route)) throw new Error('Invalid route.');
  const target = deploymentURL(deploymentURL(entry).origin + route);
  if (!matchesMobileGrant(grantForEntry(entry), target.href)) throw new Error('Route is outside the configured deployment.');
  return target.href;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

export class MobileFixtureBroker {
  private active?: MobileDocument;
  private grant?: MobileGrant;
  private storageGrant?: MobileGrant;
  private storage?: PageKVService;
  constructor(store?: PageKVStore) {
    if (store) this.storage = new PageKVService(store, url => Boolean(this.storageGrant && matchesMobileGrant(this.storageGrant, url)));
  }
  approveStorage(grant?: MobileGrant) { this.storageGrant = grant && { ...grant }; }
  private isCurrent(context: MobileDocument & { isMainFrame: boolean }) {
    return Boolean(context.isMainFrame && this.active?.documentId === context.documentId && this.active?.documentURL === context.documentURL);
  }
  async handleAsync(context: MobileDocument & { isMainFrame: boolean }, raw: string): Promise<MobileReply> {
    if (pageKVBytes(raw) > maxMobileMessageBytes) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message exceeds 16 KiB.' } };
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return this.handle(context, raw); }
    if (!plain(input) || typeof input.method !== 'string' || !input.method.startsWith('kv.')) return this.handle(context, raw);
    const id = typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(input.id) ? input.id : null;
    const error = (message: string): MobileReply => ({ jsonrpc: '2.0', id, error: { code: -32001, message } });
    if (!id || input.jsonrpc !== '2.0' || !only(input, ['jsonrpc', 'id', 'method', 'params']) || !plain(input.params)) return error('Invalid or excessive storage RPC.');
    const operation = ({ 'kv.snapshot': 'kvSnapshot', 'kv.set': 'kvSet', 'kv.remove': 'kvRemove', 'kv.clear': 'kvClear' } as Record<string, string>)[input.method];
    if (!operation || !this.storage || !this.isCurrent(context)) return error('Storage method or native document unavailable.');
    // Do not allow params to overwrite the broker-selected operation.
    if ('operation' in input.params) return error('Unexpected storage parameters.');
    try {
      const result = await this.storage.request(context.documentURL, { ...input.params, operation }, () => this.isCurrent(context));
      return { jsonrpc: '2.0', id, result };
    } catch (cause) { return error(cause instanceof Error ? cause.message : 'Page storage failed.'); }
  }
  // Native callbacks supply document identity; payload fields never do.
  activate(document: MobileDocument) { this.active = { ...document }; }
  invalidate() { this.active = undefined; }
  approve(grant?: MobileGrant) { this.grant = grant && { ...grant }; }
  handle(context: MobileDocument & { isMainFrame: boolean }, raw: string): MobileReply {
    let id: string | null = null;
    const fail = (code: number, message: string): MobileReply => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!this.active || !context.isMainFrame || this.active.documentId !== context.documentId || this.active.documentURL !== context.documentURL ||
        !this.grant || !matchesMobileGrant(this.grant, context.documentURL)) return fail(-32001, 'Document has no native fixture grant.');
    // UTF-8 bound without depending on TextEncoder in the React Native runtime.
    if (pageKVBytes(raw) > maxMobileMessageBytes) return fail(-32600, 'Message exceeds 16 KiB.');
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return fail(-32700, 'Invalid JSON.'); }
    if (plain(input) && typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(input.id)) id = input.id;
    if (!plain(input) || !only(input, ['jsonrpc', 'id', 'method', 'params']) || input.jsonrpc !== '2.0' || !id || typeof input.method !== 'string') return fail(-32600, 'Expected one JSON-RPC 2.0 request with a bounded string id.');
    if (!plain(input.params)) return fail(-32602, 'Expected named parameters.');
    if (input.method === 'companion.discover') {
      if (!only(input.params, ['protocolVersion']) || input.params.protocolVersion !== mobileProtocol) return fail(-32602, 'Unsupported protocol. Update the app/page.');
      return { jsonrpc: '2.0', id, result: { protocolVersion: mobileProtocol, fixtureOnly: true, capabilities: ['companion.discover', 'fixture.echo'] } };
    }
    if (input.method === 'fixture.echo') {
      if (!only(input.params, ['text']) || typeof input.params.text !== 'string' || input.params.text.length > 1024) return fail(-32602, 'Echo text must be at most 1024 characters.');
      return { jsonrpc: '2.0', id, result: { text: input.params.text } };
    }
    return fail(-32601, 'Method is not available in the fixture-only companion.');
  }
}

// App-bundled bootstrap only. JSON encoding is essential: neither message data
// nor IDs become executable source. Native also checks identity before eval.
export function mobileBootstrap(documentId: string, platform: 'ios' | 'android'): string {
  return `(() => {
    if (window.top !== window) return;
    const generation = ${JSON.stringify(documentId)};
    const post = ${platform === 'ios' ? '(data) => window.webkit.messageHandlers.companion.postMessage(data)' : '(data) => window.companion.postMessage(data)'};
    window.githubUltimateNative = Object.freeze({ protocolVersion: 1, documentId: generation, postMessage: (data) => { if (typeof data === 'string') post(data); } });
    window.githubUltimateReceive = (expected, data) => { if (expected === generation) window.dispatchEvent(new CustomEvent('github-ultimate-native-message', { detail: data })); };
    window.dispatchEvent(new Event('github-ultimate-native-ready'));
  })(); true;`;
}

export function mobileReplyScript(documentId: string, data: string): string {
  return `window.githubUltimateReceive?.(${JSON.stringify(documentId)}, ${JSON.stringify(data)}); true;`;
}

import { trustedOrigin } from './hosted-protocol';

export type HostedGrant = { origin: string; subpath: string };

export function trustedSubpath(input: string): string {
  const path = input.trim() || '/';
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#*\s]/.test(path) || /%(?:2f|5c|2e|25)/i.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Use an absolute directory path without queries, fragments, wildcards or encoded path separators.');
  }
  try { decodeURIComponent(path); } catch { throw new Error('Invalid URL path encoding.'); }
  const normalized = new URL(path, 'https://path.invalid').pathname;
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '') + '/';
}

export function hostedGrants(record: { origins?: string[]; hostedGrants?: HostedGrant[] }): HostedGrant[] {
  // Once written, the new field is authoritative, even when empty. Never union
  // obsolete broad grants back into a connection the user has narrowed.
  return record.hostedGrants ?? (record.origins ?? []).map(origin => ({ origin: trustedOrigin(origin), subpath: '/' }));
}

export function loadedDocument(input: string): URL {
  const url = new URL(input);
  trustedOrigin(url.origin);
  if (url.username || url.password) throw new Error('Invalid document URL.');
  if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) throw new Error('Ambiguous document path encoding.');
  return url;
}

export function matchesGrant(grant: HostedGrant, document: URL): boolean {
  if (grant.origin !== document.origin) return false;
  const path = trustedSubpath(grant.subpath);
  return path === '/' || document.pathname === path.slice(0, -1) || document.pathname.startsWith(path);
}

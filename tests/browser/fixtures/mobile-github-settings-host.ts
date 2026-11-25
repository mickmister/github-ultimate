import { Connections } from '../../../src/connections';
import { MobileConnectionStore } from '../../../src/mobile-connection-store';
import { MobileGitHub } from '../../../src/mobile-github';
const metadata = new Map<string, string>(), vault = new Map<string, string>();
const store = new MobileConnectionStore({ getItem: async key => metadata.get(key) ?? null, setItem: async (key, value) => { metadata.set(key, value); } }, { getItem: async key => vault.get(key) ?? null, setItem: async (key, value) => { vault.set(key, value); }, removeItem: async key => { vault.delete(key); } }, () => crypto.randomUUID());
const fetcher: typeof fetch = async url => {
  if (String(url).endsWith('/device/code')) return Response.json({ device_code: 'private-device', user_code: 'ALWAYS-ON', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
  if (String(url).endsWith('/oauth/access_token')) return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'bearer', expires_in: 28800, refresh_token_expires_in: 15897600 });
  if (String(url).endsWith('/user')) return Response.json({ id: 1, login: 'owner' });
  if (String(url).includes('/user/installations?')) return Response.json({ installations: [{ id: 7, app_id: 123, account: { login: 'owner' }, permissions: { contents: 'read', metadata: 'read' } }] });
  if (String(url).includes('/user/installations/7/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/private', private: true, default_branch: 'main' }] });
  throw Error('Unexpected fixture route');
};
export const github = new MobileGitHub(new Connections(store, fetcher));

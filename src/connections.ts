import { z } from 'zod';
import { hostedRequestSchema, trustedOrigin, type HostedConnection } from './hosted-protocol';
import { boundedJSON, gitReadSchema, maxMetadataBytes, readGit } from './git-reads';
import { ApiReadCache, responseCooldown, type ApiCooldown } from './github-rate-limit';

export const defaultClient = { name: 'GitHub Ultimate client', appId: 5684700, clientId: 'Iv23liGu3PxdoBoqgLiD' };
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('add'), name: z.string().trim().min(1).max(80), appId: z.number().int().positive(), clientId: identifier }).strict(),
  ...(['start', 'poll', 'refresh', 'installations', 'repositories', 'disconnect', 'remove'] as const).map(operation => z.object({ operation: z.literal(operation), id: z.string().uuid() }).strict()),
  z.object({ operation: z.literal('selectInstallation'), id: z.string().uuid(), installationId: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('probe'), id: z.string().uuid(), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(220) }).strict(),
  z.object({ operation: z.enum(['grantOrigin', 'revokeOrigin']), id: z.string().uuid(), origin: z.string().max(300) }).strict(),
]);
export type ConnectionRequest = z.infer<typeof requestSchema>;
type Identity = { login: string; id: number };
type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number; refreshExpiresAt?: number };
type Pending = { deviceCode: string; userCode: string; expiresAt: number; interval: number; nextPollAt: number };
export type ConnectionRecord = {
  id: string; name: string; appId: number; clientId: string; user?: Identity;
  installation?: { id: number; account: string }; tokens?: Tokens; pending?: Pending;
  origins?: string[];
  apiCooldown?: ApiCooldown;
};
export interface ConnectionStore {
  all(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | undefined>;
  put(record: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
const tokenSchema = z.object({
  access_token: z.string().min(1), token_type: z.literal('bearer'), expires_in: z.number().positive(),
  refresh_token: z.string().min(1), refresh_token_expires_in: z.number().positive(),
});
const installationSchema = z.object({
  id: z.number().int().positive(), app_id: z.number().int(), account: z.object({ login: z.string() }),
  permissions: z.record(z.string(), z.string()),
});
const repoSchema = z.object({ full_name: z.string(), private: z.boolean(), default_branch: z.string() });
export type Installation = z.infer<typeof installationSchema>;
export type Repository = z.infer<typeof repoSchema>;
export class ConnectionError extends Error {}

function publicConnection(record: ConnectionRecord) {
  const { id, name, appId, clientId, user, installation, tokens, pending, origins } = record;
  return {
    id, name, appId, clientId, user, installation, connected: Boolean(tokens), expiresAt: tokens?.expiresAt,
    refreshExpiresAt: tokens?.refreshExpiresAt,
    origins: origins ?? [],
    pending: pending && { userCode: pending.userCode, expiresAt: pending.expiresAt, nextPollAt: pending.nextPollAt },
  };
}
export type PublicConnection = ReturnType<typeof publicConnection>;

// This module runs only in the privileged broker. No token-bearing record is a
// message response, and callers cannot choose an endpoint, method or headers.
export class Connections {
  private tail: Promise<unknown> = Promise.resolve();
  private apiCache = new ApiReadCache();
  constructor(private store: ConnectionStore, private fetcher: typeof fetch = (...args) => fetch(...args), private now = () => Date.now()) {}

  handle(input: unknown): Promise<unknown> {
    const request = requestSchema.parse(input);
    // Serialize refresh rotation, disconnect and polling, including concurrent
    // requests from multiple settings tabs. Persist each transition before reply.
    const result = this.tail.catch(() => {}).then(() => this.execute(request));
    this.tail = result;
    return result;
  }

  handleHosted(origin: string, input: unknown): Promise<unknown> {
    const source = trustedOrigin(origin);
    const request = hostedRequestSchema.parse(input);
    const result = this.tail.catch(() => {}).then(async () => {
      const records = await this.store.all();
      const approved = records.filter(record => record.origins?.includes(source));
      if (!approved.length) throw new ConnectionError('This origin has no approved connections. Grant access in extension settings and reload the page.');
      if (request.operation === 'discover') return { protocolVersion: 1, capabilities: ['connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'implicitWorkspaces'] };
      if (request.operation === 'connections') return approved.filter(record => record.tokens && record.installation).map(({ id, name, appId, user, installation }): HostedConnection => ({ id, name, appId, user, installation }));
      const record = approved.find(record => record.id === request.id);
      if (!record) throw new ConnectionError('This connection is not approved for this origin.');
      if (gitReadSchema.safeParse(request).success) {
        const gitRequest = gitReadSchema.parse(request);
        if (record.installation?.id !== gitRequest.installationId) throw new ConnectionError('The selected installation changed. Reconnect and rediscover workspaces; no fallback is allowed.');
        const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === gitRequest.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Repository is not available through the selected installation and user.');
        try { return await readGit(gitRequest, repo.full_name, (path, maxBytes) => this.api(record, path, maxBytes, gitRequest.operation === 'gitRefs' ? 'conditional' : 'immutable')); }
        catch (error) { this.apiCache.clearConnection(record.id); throw error; }
      }
      if (request.operation !== 'repositories' && request.operation !== 'probe') throw new ConnectionError('Unsupported hosted operation.');
      return this.execute(request);
    });
    this.tail = result;
    return result;
  }

  private async send(url: string, init: RequestInit) {
    let response: Response;
    try { response = await this.fetcher(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
    catch { throw new ConnectionError('GitHub request failed or timed out. Retry when online.'); }
    return response;
  }

  private async json(url: string, init: RequestInit, maxBytes = maxMetadataBytes) {
    const response = await this.send(url, init);
    if (!response.ok) throw new ConnectionError(`GitHub returned HTTP ${response.status}. Check access, authorization and rate limits.`);
    try { return await boundedJSON(response, maxBytes) as any; }
    catch { throw new ConnectionError('GitHub returned an unreadable response or exceeded the read limit.'); }
  }

  private oauth(path: 'device/code' | 'oauth/access_token', parameters: Record<string, string>) {
    return this.json(`https://github.com/login/${path}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters).toString(),
    });
  }

  private async api(record: ConnectionRecord, path: string, maxBytes = maxMetadataBytes, cache: 'none' | 'conditional' | 'immutable' = 'none'): Promise<unknown> {
    const records = await this.store.all();
    const related = records.filter(other => other.id === record.id || record.user && other.user?.id === record.user.id || other.apiCooldown?.scope === 'global');
    const until = Math.max(0, ...related.map(other => other.apiCooldown?.until ?? 0));
    if (until > this.now()) throw new ConnectionError(`GitHub API rate limit: retry after ${new Date(until).toISOString()}. No request was sent.`);
    const token = await this.accessToken(record);
    const key = `${record.id}:${record.installation?.id ?? 0}:${path}`;
    const cached = cache === 'none' ? undefined : this.apiCache.get(key);
    if (cache === 'immutable' && cached) return structuredClone(cached.value);
    const response = await this.send(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(cache === 'conditional' && cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
    });
    const cooldown = await responseCooldown(response, this.now(), Math.max(0, ...related.map(other => other.apiCooldown?.failures ?? 0)));
    // Keep the live record (possibly refreshed above) and persisted records in
    // sync. Device-flow tokens share the user's budget, not installation budgets.
    for (const other of records) {
      const target = other.id === record.id ? record : other;
      if (cooldown && (cooldown.scope === 'global' || target.id === record.id || record.user && target.user?.id === record.user.id)) {
        target.apiCooldown = { ...cooldown, until: Math.max(cooldown.until, target.apiCooldown?.until ?? 0) };
        await this.store.put(target);
      } else if (!cooldown && (response.ok || response.status === 304) && target.apiCooldown && target.apiCooldown.until <= this.now()) {
        delete target.apiCooldown; await this.store.put(target);
      }
    }
    if (!response.ok && cooldown) throw new ConnectionError(`GitHub API rate limit: retry after ${new Date(cooldown.until).toISOString()}. Retry manually after the cooldown.`);
    if (response.status === 304 && cached) return structuredClone(cached.value);
    if (!response.ok) { this.apiCache.clearConnection(record.id); throw new ConnectionError(`GitHub returned HTTP ${response.status}. Check access, authorization and rate limits.`); }
    let value: unknown;
    try { value = await boundedJSON(response, maxBytes); }
    catch { throw new ConnectionError('GitHub returned an unreadable response or exceeded the read limit.'); }
    if (cache !== 'none') this.apiCache.put(key, value, response.headers.get('etag') ?? undefined);
    return value;
  }

  private saveTokens(record: ConnectionRecord, data: unknown) {
    const parsed = tokenSchema.safeParse(data);
    if (!parsed.success) throw new ConnectionError('Expected expiring device-flow credentials. Enable expiring user tokens and device flow in the App settings.');
    const t = parsed.data;
    record.tokens = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: this.now() + t.expires_in * 1000, refreshExpiresAt: this.now() + t.refresh_token_expires_in * 1000 };
    delete record.pending;
  }

  private async refresh(record: ConnectionRecord) {
    const tokens = record.tokens;
    if (!tokens?.refreshToken || !tokens.refreshExpiresAt || tokens.refreshExpiresAt <= this.now()) {
      throw new ConnectionError('Sign in again: no usable refresh token.');
    }
    const data = await this.oauth('oauth/access_token', { client_id: record.clientId, grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    if (data.error) {
      if (['bad_refresh_token', 'invalid_grant', 'expired_token'].includes(data.error)) {
        delete record.tokens;
        await this.store.put(record);
      }
      throw new ConnectionError('Refresh did not succeed. Retry, or sign in again if authorization expired or was revoked.');
    }
    this.saveTokens(record, data);
    // Rotation invalidates the old pair. Persist the replacement before any API
    // call or response, not when the settings tab next happens to save.
    await this.store.put(record);
  }

  private async accessToken(record: ConnectionRecord) {
    if (!record.tokens) throw new ConnectionError('Sign in to this connection first.');
    if (record.tokens.expiresAt <= this.now() + 60000) await this.refresh(record);
    return record.tokens!.accessToken;
  }

  private async installations(record: ConnectionRecord) {
    const all: Installation[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = z.object({ installations: z.array(installationSchema) }).parse(await this.api(record, `/user/installations?per_page=100&page=${page}`));
      all.push(...data.installations.filter(i => i.app_id === record.appId));
      if (data.installations.length < 100) return all;
    }
    throw new ConnectionError('Installation list exceeded the prototype limit; no partial list was selected.');
  }

  private async repositories(record: ConnectionRecord) {
    if (!record.installation) throw new ConnectionError('Select an installation first.');
    const all: Repository[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = z.object({ repositories: z.array(repoSchema) }).parse(await this.api(record, `/user/installations/${record.installation.id}/repositories?per_page=100&page=${page}`, maxMetadataBytes, 'conditional'));
      all.push(...data.repositories);
      if (data.repositories.length < 100) return all;
    }
    throw new ConnectionError('Repository list exceeded the prototype limit; narrow the installation for this proof.');
  }

  private async execute(request: ConnectionRequest): Promise<unknown> {
    if (request.operation === 'list') return (await this.store.all()).map(publicConnection);
    if (request.operation === 'add') {
      const record: ConnectionRecord = { id: crypto.randomUUID(), name: request.name, appId: request.appId, clientId: request.clientId };
      await this.store.put(record);
      return publicConnection(record);
    }
    const record = await this.store.get(request.id);
    if (!record) throw new ConnectionError('Connection no longer exists.');
    switch (request.operation) {
      case 'remove': this.apiCache.clearConnection(record.id); await this.store.remove(record.id); return null;
      case 'disconnect':
        this.apiCache.clearConnection(record.id);
        delete record.tokens; delete record.pending; delete record.user; delete record.installation;
        delete record.origins;
        await this.store.put(record); return publicConnection(record);
      case 'grantOrigin': {
        const origin = trustedOrigin(request.origin);
        if (!record.tokens || !record.installation) throw new ConnectionError('Sign in and select an installation before granting hosted access.');
        record.origins = [...new Set([...(record.origins ?? []), origin])];
        await this.store.put(record); return publicConnection(record);
      }
      case 'revokeOrigin':
        record.origins = (record.origins ?? []).filter(origin => origin !== trustedOrigin(request.origin));
        await this.store.put(record); return publicConnection(record);
      case 'start': {
        if (record.tokens) throw new ConnectionError('Disconnect this connection before signing in again.');
        const data = z.object({ device_code: z.string().min(1), user_code: z.string().min(1), verification_uri: z.literal('https://github.com/login/device'), expires_in: z.number().positive(), interval: z.number().positive() })
          .parse(await this.oauth('device/code', { client_id: record.clientId, scope: 'offline_access' }));
        record.pending = { deviceCode: data.device_code, userCode: data.user_code, expiresAt: this.now() + data.expires_in * 1000, interval: Math.max(5, data.interval), nextPollAt: this.now() + Math.max(5, data.interval) * 1000 };
        await this.store.put(record); return publicConnection(record);
      }
      case 'poll': {
        const pending = record.pending;
        if (!pending) return publicConnection(record);
        if (pending.expiresAt <= this.now()) {
          delete record.pending; await this.store.put(record);
          throw new ConnectionError('Device code expired. Start sign-in again.');
        }
        if (pending.nextPollAt > this.now()) return publicConnection(record);
        pending.nextPollAt = this.now() + pending.interval * 1000;
        await this.store.put(record);
        const data = await this.oauth('oauth/access_token', { client_id: record.clientId, device_code: pending.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (data.error === 'authorization_pending') return publicConnection(record);
        if (data.error === 'slow_down') {
          pending.interval += 5; pending.nextPollAt = this.now() + pending.interval * 1000;
          await this.store.put(record); return publicConnection(record);
        }
        if (data.error) {
          delete record.pending; await this.store.put(record);
          throw new ConnectionError('Device authorization was denied, expired, or unavailable. Check device flow is enabled and sign in again.');
        }
        this.saveTokens(record, data);
        await this.store.put(record);
        // Identity discovery is retriable independently of token issuance.
        record.user = z.object({ login: z.string(), id: z.number() }).parse(await this.api(record, '/user'));
        await this.store.put(record); return publicConnection(record);
      }
      case 'refresh': await this.refresh(record); return publicConnection(record);
      case 'installations': {
        if (!record.user) {
          record.user = z.object({ login: z.string(), id: z.number() }).parse(await this.api(record, '/user'));
          await this.store.put(record);
        }
        return this.installations(record);
      }
      case 'selectInstallation': {
        const installation = (await this.installations(record)).find(i => i.id === request.installationId);
        if (!installation) throw new ConnectionError('Installation is not available through this App and user.');
        // Check actual approved permissions, not merely what the client claims.
        if (Object.entries(installation.permissions).some(([key, value]) => value !== 'read' && value !== 'none' && !(key === 'actions' && value === 'write'))) {
          throw new ConnectionError('This installation grants writes beyond Actions. Use the read-only client App, not the CI App.');
        }
        this.apiCache.clearConnection(record.id);
        record.installation = { id: installation.id, account: installation.account.login };
        await this.store.put(record); return publicConnection(record);
      }
      case 'repositories': return this.repositories(record);
      case 'probe': {
        const repo = (await this.repositories(record)).find(r => r.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Repository is not available through the selected installation and user.');
        const [owner, name] = repo.full_name.split('/');
        const data = z.object({ object: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/), type: z.literal('commit') }) })
          .parse(await this.api(record, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${repo.default_branch.split('/').map(encodeURIComponent).join('/')}`));
        return { ...repo, headOid: data.object.sha, checkedAt: new Date(this.now()).toISOString() };
      }
    }
  }
}

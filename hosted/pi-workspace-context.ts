import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifiedGitBlobBytes } from '../src/git-blob';
import type { GitBlob, GitRef } from '../src/git-reads';
import type { HostedConnection } from '../src/hosted-protocol';
import { s3BucketURL, s3Key, type PublicS3Connection, type S3Listing, type S3Object } from '../src/s3-protocol';
import { contextPath, workspaceContextSourcesSchema, workspaceFilesSchema, workspaceSourcesSchema, type WorkspaceFilesInput } from '../src/workspace-context-interface';
import type { ChatWorkspace } from './pi-chat-contract';
import type { PiBridge } from './pi-transport';
import { documents, documentText, WorkspaceReader } from './workspaces';

const maxFileBytes = 128 * 1024, maxEntries = 2000, maxDirectories = 128;
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const treeEntries = z.array(z.object({ name: contextPath.refine(value => !!value && !value.includes('/')), mode: z.enum(['100644', '100755', '40000', '120000', '160000']), oid, type: z.enum(['blob', 'tree', 'commit']), size: z.number().int().nonnegative().optional() })).max(10000);
type Entry = { path: string; kind: 'file' | 'directory' | 'unsupported'; size?: number; version?: string; etag?: string };
type Source = {
  id: string; kind: 'documents' | 'github' | 's3'; provenance: Record<string, unknown>;
  authorize(signal?: AbortSignal): Promise<void>;
  list(path: string, signal?: AbortSignal): Promise<{ entries: Entry[]; complete: boolean }>;
  read(entry: Entry, signal?: AbortSignal): Promise<{ text: string; provenance: Record<string, unknown> }>;
};
const regular = (mode: string) => mode === '100644' || mode === '100755';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Workspace source unavailable.';
function documentURL(workspace: ChatWorkspace, path: string, version: string) {
  if (typeof location === 'undefined') return null;
  const url = new URL('../app/', location.href);
  url.hash = `/documents/${encodeURIComponent(`${version}:documents/${path}`)}?${new URLSearchParams({ repository: workspace.repository, workspace: workspace.workspace })}`;
  return url.href;
}
function githubRemote(remote: string) {
  const scp = /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
  if (scp) return scp[1].toLowerCase();
  try {
    const url = new URL(remote);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname !== 'github.com' || url.password || url.search || url.hash || url.protocol === 'https:' && url.username) return;
    const repository = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return repository.toLowerCase();
  } catch { /* Non-GitHub remote: not a browser-readable source. */ }
}

/** Created once per explicit invocation, shared across all its codemode scripts.
 * Only metadata is loaded for discovery; blobs are read on demand. */
export class PiWorkspaceContext {
  private pending?: Promise<void>;
  private sources = new Map<string, Source>();
  private notices: { source: string; error: string }[] = [];
  private scope?: ChatWorkspace;
  private selectedConnection?: string;
  private connectionChoice?: string;
  private snapshot?: string;
  private requests = 0;
  private receivedBytes = 0;
  constructor(private send: PiBridge, private storageSend: PiBridge, private workspace: () => Promise<ChatWorkspace | undefined>) {}
  private async check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const current = await this.workspace();
    if (!current || this.scope && (current.repository.toLowerCase() !== this.scope.repository.toLowerCase() || current.workspace !== this.scope.workspace)) throw Error('Select the current conversation workspace before reading context.');
    signal?.throwIfAborted(); return current;
  }
  private async request<T>(send: PiBridge, request: Parameters<PiBridge>[0], signal?: AbortSignal) {
    await this.check(signal);
    if (++this.requests > 256) throw Error('Workspace context read budget reached (256 host requests). Continue in a new invocation.');
    const value = await send<T>(request); await this.check(signal);
    this.receivedBytes += new TextEncoder().encode(JSON.stringify(value)).length;
    if (this.receivedBytes > 16 * 1024 * 1024) throw Error('Workspace context byte budget reached (16 MiB). Continue in a new invocation.');
    return value;
  }
  private async initialize(connectionId?: string, signal?: AbortSignal) {
    await this.check(signal);
    if (this.pending) {
      if (connectionId && connectionId !== this.connectionChoice && connectionId !== this.selectedConnection) throw Error('This invocation already uses another workspace connection. Start a new invocation to change it.');
      return this.pending;
    }
    this.connectionChoice = connectionId;
    this.pending = this.open(connectionId, signal);
    return this.pending;
  }
  private async authorizeGit(original: HostedConnection, repository: string, signal?: AbortSignal) {
    const connections = await this.request<HostedConnection[]>(this.send, { operation: 'connections' }, signal);
    if (!connections.some(value => value.id === original.id && value.user?.id === original.user?.id && value.installation?.id === original.installation?.id)) throw Error('Original workspace GitHub authorization changed.');
    const repositories = await this.request<{ full_name: string }[]>(this.send, { operation: 'repositories', id: original.id }, signal);
    if (!repositories.some(value => value.full_name.toLowerCase() === repository.toLowerCase())) throw Error('Workspace repository authorization changed.');
  }
  private async open(connectionId?: string, signal?: AbortSignal) {
    this.scope = await this.check(signal);
    const workspace = this.scope;
    const connections = await this.request<HostedConnection[]>(this.send, { operation: 'connections' }, signal);
    if (connections.length > 32) throw Error('More than 32 connections; narrow the approved connections before reading context.');
    const inventories = new Map<string, string[]>();
    for (const connection of connections.filter(value => value.installation && (!connectionId || value.id === connectionId))) {
      try { inventories.set(connection.id, (await this.request<{ full_name: string }[]>(this.send, { operation: 'repositories', id: connection.id }, signal)).map(repo => repo.full_name.toLowerCase())); }
      catch (error) { signal?.throwIfAborted(); this.notices.push({ source: `connection:${connection.id}`, error: errorText(error) }); }
    }
    const choose = (repository: string, actor = false) => {
      const matches = connections.filter(value => value.installation && (!actor || value.user) && inventories.get(value.id)?.includes(repository.toLowerCase()));
      if (matches.length !== 1) throw Error(`Repository ${repository} requires one approved connection; use connectionId to resolve ambiguity.`);
      return matches[0];
    };
    const connection = choose(workspace.repository); this.selectedConnection = connection.id;
    const reader = new WorkspaceReader(<T>(request: Parameters<PiBridge>[0]) => this.request<T>(this.send, request, signal), connection.id, workspace.repository, connection.installation!.id, workspace.workspace);
    const refs = await this.request<GitRef[]>(this.send, { operation: 'gitRefs', id: connection.id, installationId: connection.installation!.id, repository: workspace.repository, prefix: 'documents/' }, signal);
    const commit = refs.find(ref => ref.ref === `refs/documents/${workspace.workspace}`)?.object.sha;
    if (!commit) throw Error('Selected workspace has no document manifest.');
    const opened = await reader.open({ name: workspace.workspace, documents: commit }); await this.check(signal);
    this.snapshot = opened.snapshot.commit;
    const docEntries = documents(opened.snapshot);
    const docFiles: Entry[] = docEntries.map(entry => ({ path: entry.path.slice(10), kind: 'file', size: entry.size, version: entry.sha }));
    const provenance = { ...workspace, snapshot: this.snapshot, manifestVersion: opened.version };
    this.sources.set('documents', { id: 'documents', kind: 'documents', provenance,
      authorize: signal => this.authorizeGit(connection, workspace.repository, signal),
      list: async path => ({ entries: immediate(docFiles, path), complete: true }),
      read: async (entry, signal) => {
        const found = docEntries.find(value => value.path === `documents/${entry.path}` && value.sha === entry.version);
        if (!found || (found.size ?? Infinity) > maxFileBytes) throw Error('Document unavailable or exceeds 128 KiB.');
        const text = documentText(await reader.blob(found, signal)); await this.check(signal);
        return { text, provenance: { ...provenance, path: entry.path, version: found.sha, url: documentURL(workspace, entry.path, found.sha) } };
      },
    });
    const members = opened.manifest.repositories ?? [];
    if (members.length > 32) throw Error('Workspace context supports at most 32 associated source members.');
    const revisions = new Map<string, { expression: string; commit: string; tree: string }>();
    for (const member of members) {
      const id = `github:${member.path}`;
      try {
        const remotes = member.remotes ?? [], origin = remotes.filter(remote => remote.name === 'origin');
        const repositories = [...new Set((origin.length ? origin : remotes).map(remote => githubRemote(remote.url)).filter((value): value is string => !!value))];
        if (repositories.length !== 1) throw Error('Member needs one unambiguous GitHub origin remote; local paths are not repository identities.');
        const repository = repositories[0], connection = choose(repository, true);
        const scope = { id: connection.id, userId: connection.user!.id, installationId: connection.installation!.id, repository };
        const expression = member.branch;
        let pin = revisions.get(repository);
        if (pin && pin.expression !== expression) throw Error('Members of one repository name conflicting revisions; no mixed-revision reads are allowed.');
        if (!pin) {
          const [owner, name] = repository.split('/');
          const value = await this.request(this.send, { operation: 'agentGraphql', id: scope.id, userId: scope.userId, installationId: scope.installationId,
            query: 'query($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){object(expression:$expression){... on Commit{oid tree{oid}}}}}', variables: { owner, name, expression } }, signal);
          const result = z.object({ data: z.object({ repository: z.object({ object: z.object({ oid, tree: z.object({ oid }) }) }) }), errors: z.array(z.unknown()).optional() }).parse(value);
          if (result.errors?.length) throw Error('Source branch is not available at the published remote.');
          pin = { expression, commit: result.data.repository.object.oid, tree: result.data.repository.object.tree.oid }; revisions.set(repository, pin);
        }
        const trees = new Map<string, Promise<z.infer<typeof treeEntries>>>();
        const tree = (oid: string, signal?: AbortSignal) => {
          if (!trees.has(oid)) trees.set(oid, this.request(this.send, { operation: 'agentTree', ...scope, oid }, signal).then(value => treeEntries.parse(value)));
          return trees.get(oid)!;
        };
        const root = pin.tree;
        const provenance = { ...workspace, manifestSnapshot: this.snapshot, member: member.path, repository, ref: expression, commit: pin.commit, publication: member.publication, dirty: member.dirty ?? false };
        this.sources.set(id, { id, kind: 'github', provenance,
          authorize: signal => this.authorizeGit(connection, repository, signal),
          list: async (path, signal) => {
            let oid = root;
            for (const name of path ? path.split('/') : []) {
              const entry = (await tree(oid, signal)).find(entry => entry.name === name && entry.type === 'tree' && entry.mode === '40000');
              if (!entry) throw Error('Directory not found at pinned commit.'); oid = entry.oid;
            }
            return { entries: (await tree(oid, signal)).map(entry => ({ path: path ? `${path}/${entry.name}` : entry.name, kind: entry.type === 'tree' && entry.mode === '40000' ? 'directory' : entry.type === 'blob' && regular(entry.mode) ? 'file' : 'unsupported', size: entry.size, version: entry.oid })), complete: true };
          },
          read: async (entry, signal) => {
            if (!entry.version || (entry.size ?? Infinity) > maxFileBytes) throw Error('Source file exceeds 128 KiB or has no verified size.');
            const blob = z.object({ sha: z.literal(entry.version), size: z.number().int().min(0).max(maxFileBytes), encoding: z.literal('base64'), content: z.string().max(192 * 1024) }).parse(await this.request<GitBlob>(this.send, { operation: 'agentBlob', ...scope, oid: entry.version }, signal));
            if (blob.size !== entry.size) throw Error('Source blob size mismatch.');
            return { text: documentText(verifiedGitBlobBytes(blob)), provenance: { ...provenance, path: entry.path, version: entry.version, url: `https://github.com/${repository}/blob/${pin!.commit}/${entry.path.split('/').map(encodeURIComponent).join('/')}` } };
          },
        });
      } catch (error) { await this.check(signal); this.notices.push({ source: id, error: errorText(error) }); }
    }
    const config = docEntries.find(entry => entry.path === 'documents/workspace/context-sources.json');
    if (config) {
      try {
        if ((config.size ?? Infinity) > 32 * 1024) throw Error('Context source config exceeds 32 KiB.');
        const bindings = workspaceContextSourcesSchema.parse(JSON.parse(documentText(await reader.blob(config, signal)))); await this.check(signal);
        const stores = await this.request<PublicS3Connection[]>(this.storageSend, { operation: 's3Connections' }, signal);
        for (const binding of bindings.sources) {
          const id = `s3:${binding.id}`;
          try {
            s3Key(binding.prefix);
            const matches = stores.filter(store => store.allowRead && store.endpoint === binding.endpoint && store.bucket === binding.bucket && binding.prefix.startsWith(store.prefix));
            if (matches.length !== 1) throw Error('S3 source requires one approved matching endpoint/bucket/prefix connection.');
            const store = matches[0]; s3BucketURL(store);
            this.sources.set(id, this.s3Source(id, store, binding.prefix, { ...workspace, snapshot: this.snapshot, configVersion: config.sha, endpoint: binding.endpoint, bucket: binding.bucket, prefix: binding.prefix }));
          } catch (error) { this.notices.push({ source: id, error: errorText(error) }); }
        }
      } catch (error) { await this.check(signal); this.notices.push({ source: 's3', error: errorText(error) }); }
    } else this.notices.push({ source: 's3', error: 'No workspace/context-sources.json bindings. Arbitrary connection prefixes and conversation storage are not workspace file sources.' });
  }
  private s3Source(id: string, store: PublicS3Connection, prefix: string, provenance: Record<string, unknown>): Source {
    let pending: Promise<{ entries: Entry[]; complete: boolean }> | undefined;
    const inventory = (signal?: AbortSignal) => pending ??= (async () => {
      const entries: Entry[] = []; let continuationToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result: S3Listing = await this.request(this.storageSend, { operation: 's3List', id: store.id, revision: store.revision, prefix, continuationToken }, signal);
        for (const object of result.objects) {
          if (!object.key.startsWith(prefix)) throw Error('S3 listing escaped its workspace binding.');
          const path = object.key.slice(prefix.length);
          if (!path || path.endsWith('/')) continue;
          contextPath.parse(path); entries.push({ path, kind: 'file', size: object.size, version: object.versionId, etag: object.etag });
        }
        continuationToken = result.continuationToken;
        if (entries.length > maxEntries) throw Error('S3 context inventory exceeds 2,000 files; configure a narrower prefix.');
        if (!continuationToken) return { entries, complete: true };
      }
      return { entries, complete: false };
    })();
    return { id, kind: 's3', provenance,
      authorize: async signal => {
        const stores = await this.request<PublicS3Connection[]>(this.storageSend, { operation: 's3Connections' }, signal);
        if (!stores.some(value => value.id === store.id && value.revision === store.revision && value.allowRead && value.endpoint === store.endpoint && value.bucket === store.bucket && prefix.startsWith(value.prefix))) throw Error('Workspace S3 authorization changed.');
      },
      list: async (path, signal) => { const result = await inventory(signal); return { entries: immediate(result.entries, path), complete: result.complete }; },
      read: async (entry, signal) => {
        const key = prefix + entry.path;
        const object = await this.request<S3Object>(this.storageSend, { operation: 's3Read', id: store.id, revision: store.revision, key, ...(entry.version ? { versionId: entry.version } : {}) }, signal);
        if (object.key !== key || object.size !== entry.size || object.size > maxFileBytes || object.base64.length > Math.ceil(maxFileBytes / 3) * 4 || entry.version && object.versionId !== entry.version || entry.etag && object.etag !== entry.etag) throw Error('S3 context object changed since discovery or failed size/version validation. Start a new invocation to refresh.');
        const bytes = Uint8Array.from(atob(object.base64), character => character.charCodeAt(0));
        if (bytes.length !== object.size) throw Error('S3 context object size mismatch.');
        return { text: documentText(bytes), provenance: { ...provenance, path: entry.path, key, versionId: object.versionId ?? null, etag: object.etag ?? null, sha256: bytesToHex(sha256(bytes)), consistency: entry.version ? 'version-pinned-read' : object.versionId ? 'observed-version-cached-this-invocation' : 'cached-bytes-this-invocation-not-an-atomic-snapshot' } };
      },
    };
  }
  async discover(input: unknown, signal?: AbortSignal) {
    const args = workspaceSourcesSchema.parse(input); await this.initialize(args.connectionId, signal); await this.check(signal);
    await this.sources.get('documents')!.authorize(signal);
    return { workspace: this.scope, snapshot: this.snapshot, sources: [...this.sources.values()].map(source => ({ id: source.id, kind: source.kind, ...source.provenance })), notices: this.notices, limits: { fileBytes: maxFileBytes, entries: maxEntries, directories: maxDirectories, searchFilesPerPage: 32 }, connectionId: this.selectedConnection };
  }
  private texts = new Map<string, Promise<{ text: string; provenance: Record<string, unknown> }>>();
  private async read(source: Source, entry: Entry, signal?: AbortSignal) {
    if (entry.kind !== 'file' || (entry.size ?? Infinity) > maxFileBytes) throw Error('Only regular UTF-8 files up to 128 KiB can be read.');
    const key = `${source.id}:${entry.path}`;
    if (!this.texts.has(key)) this.texts.set(key, source.read(entry, signal));
    const result = await this.texts.get(key)!; await this.check(signal); return result;
  }
  async files(input: unknown, signal?: AbortSignal) {
    const args = workspaceFilesSchema.parse(input); await this.initialize(args.connectionId, signal); await this.check(signal);
    const source = this.sources.get(args.source);
    if (!source) throw Error('Source is not available in the selected workspace. Call workspace_sources for IDs/errors.');
    await this.sources.get('documents')!.authorize(signal);
    if (source.id !== 'documents') await source.authorize(signal);
    const common = { source: source.id, storageRepository: this.scope!.repository, ...source.provenance };
    if (args.operation === 'read') {
      const slash = args.path.lastIndexOf('/'), parent = slash < 0 ? '' : args.path.slice(0, slash);
      const entry = (await source.list(parent, signal)).entries.find(entry => entry.path === args.path);
      if (!entry) throw Error('File not found in this source snapshot.');
      const result = await this.read(source, entry, signal), lines = result.text.split('\n');
      const selected: string[] = []; let characters = 0;
      for (const line of lines.slice(args.startLine - 1, args.startLine - 1 + args.lineCount)) {
        if (characters + line.length > 16000) break;
        selected.push(line); characters += line.length + 1;
      }
      if (!selected.length && args.startLine <= lines.length) throw Error('Line exceeds the 16,000-character response limit.');
      const nextLine = args.startLine + selected.length;
      return { ...common, ...result.provenance, content: selected.join('\n'), startLine: args.startLine, totalLines: lines.length, nextLine: nextLine <= lines.length ? nextLine : null };
    }
    if (args.operation === 'list') {
      const result = await source.list(args.path, signal); await this.check(signal);
      return { ...common, entries: result.entries.slice(args.offset, args.offset + args.limit), nextOffset: args.offset + args.limit < result.entries.length ? args.offset + args.limit : null, complete: result.complete, total: result.entries.length };
    }
    const inventory = await this.walk(source, args.path, signal);
    if (args.operation === 'find') {
      const entries = inventory.entries.filter(entry => entry.path.toLowerCase().includes(args.query!.toLowerCase()));
      return { ...common, entries: entries.slice(args.offset, args.offset + args.limit), nextOffset: args.offset + args.limit < entries.length ? args.offset + args.limit : null, coverage: inventory.coverage };
    }
    return { ...common, ...(await this.search(source, inventory, args, signal)) };
  }
  private async walk(source: Source, path: string, signal?: AbortSignal) {
    const queue = [path], entries: Entry[] = []; let directories = 0, complete = true;
    while (queue.length && directories < maxDirectories && entries.length < maxEntries) {
      const found = await source.list(queue.shift()!, signal); await this.check(signal); directories++; complete &&= found.complete;
      for (const entry of found.entries.sort((a,b) => a.path.localeCompare(b.path))) {
        if (entry.kind === 'directory') queue.push(entry.path);
        else if (entries.length < maxEntries) entries.push(entry);
        else complete = false;
      }
    }
    return { entries: entries.sort((a,b) => a.path.localeCompare(b.path)), coverage: { complete: complete && !queue.length, directories, files: entries.length, scope: path } };
  }
  private async search(source: Source, inventory: Awaited<ReturnType<PiWorkspaceContext['walk']>>, args: WorkspaceFilesInput, signal?: AbortSignal) {
    const matches: { path: string; version?: string; line: number; text: string; provenance: Record<string, unknown> }[] = [];
    const skipped: { path: string; reason: string }[] = []; let index = args.offset;
    for (; index < Math.min(inventory.entries.length, args.offset + 32) && matches.length < args.limit; index++) {
      const entry = inventory.entries[index];
      try {
        const value = await this.read(source, entry, signal), lines = value.text.split('\n');
        for (let line = 0; line < lines.length; line++) if (lines[line].toLowerCase().includes(args.query!.toLowerCase())) {
          if (matches.length >= args.limit) { skipped.push({ path: entry.path, reason: 'Additional matching lines omitted by result limit; read this file for full content.' }); break; }
          matches.push({ path: entry.path, version: entry.version, line: line + 1, text: lines[line].slice(0, 300), provenance: value.provenance });
        }
      } catch (error) { await this.check(signal); skipped.push({ path: entry.path, reason: errorText(error) }); }
    }
    return { matches, skipped, nextOffset: index < inventory.entries.length ? index : null, coverage: { ...inventory.coverage, complete: inventory.coverage.complete && args.offset === 0 && index === inventory.entries.length && !skipped.length, examinedFrom: args.offset, examinedThrough: index } };
  }
}

function immediate(files: Entry[], path: string): Entry[] {
  const prefix = path ? `${path}/` : '', found = new Map<string, Entry>();
  for (const file of files) if (file.path.startsWith(prefix)) {
    const relative = file.path.slice(prefix.length), slash = relative.indexOf('/');
    const entry: Entry = slash < 0 ? file : { path: prefix + relative.slice(0, slash), kind: 'directory' };
    found.set(entry.path, entry);
  }
  return [...found.values()].sort((a,b) => a.path.localeCompare(b.path));
}

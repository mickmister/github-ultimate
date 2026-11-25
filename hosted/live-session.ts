import { z } from 'zod';
import { bridgeRequest } from './client';
import { s3Key, s3Prefix, type PublicS3Connection, type S3Listing, type S3ReadResult } from '../src/s3-protocol';

const repository = z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220);
const binding = z.object({ workspace: z.string().regex(/^[\w-]{1,200}$/), workspace_ref: z.string().regex(/^ws-[a-f0-9]{32}$/), process: z.string().max(200), bead: z.string().max(200) });
export const liveLocatorSchema = z.object({ kind: z.literal('pi-live-locator'), schemaVersion: z.literal(1), binding,
  storageRepository: repository, repository, executionId: z.string().regex(/^[1-9]\d{0,15}-[1-9]\d{0,15}$/), command: z.enum(['open', 'work']),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/), piVersion: z.literal('1.5.2'), createdAt: z.iso.datetime(), evidencePrefix: z.string().max(1024) });
export type LiveLocator = z.infer<typeof liveLocatorSchema>;
const eventSchema = z.object({ schemaVersion: z.literal(1), sequence: z.number().int().positive().max(1000000), timestamp: z.iso.datetime(), kind: z.enum(['stage', 'started', 'completed', 'failed', 'heartbeat', 'acp', 'native', 'pi', 'command', 'progress']), sessionId: z.string().max(200).optional(), parentId: z.string().max(200).nullable().optional(), role: z.string().max(200).optional(), operation: z.string().max(200).optional(), toolCallId: z.string().max(200).optional(), data: z.unknown().optional() });
const chunkSchema = z.object({ schemaVersion: z.literal(1), binding, executionId: z.string(), phaseApproval: z.literal(false), replayAuthorized: z.literal(false), events: z.array(eventSchema).min(1).max(1000000) });
const terminalSchema = z.object({ kind: z.literal('pi-live-terminal'), schemaVersion: z.literal(1), binding, executionId: z.string(), command: z.enum(['open', 'work']), status: z.enum(['completed', 'failed']), chunks: z.number().int().min(0).max(16384), sequence: z.number().int().min(0).max(1000000), finishedAt: z.iso.datetime(), phaseApproval: z.literal(false) });
export interface LiveMessage { id: string; session: string; role: string; text: string; partial: boolean }
export interface LiveTool { id: string; name: string; state: 'running' | 'completed' | 'failed'; detail: string }
type Send = typeof bridgeRequest;
type Scope = { repository: string; workspace: string };
type Json = Record<string, unknown>;
function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => { const p = object(part); return p.type === 'text' && typeof p.text === 'string' ? p.text : p.type === 'toolCall' && typeof p.name === 'string' ? `[${p.name}]` : ''; }).filter(Boolean).join('\n');
}
function sameBinding(a: LiveLocator['binding'], b: LiveLocator['binding']) { return Object.keys(a).every(key => a[key as keyof typeof a] === b[key as keyof typeof b]); }
async function digest(bytes: Uint8Array<ArrayBuffer>) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function readJson(send: Send, connection: PublicS3Connection, key: string, limit: number, allowMissing = false) {
  s3Key(key);
  if (!key.startsWith(connection.prefix)) throw Error('Session object is outside the approved S3 prefix.');
  const result = await send<S3ReadResult>({ operation: 's3Read', id: connection.id, revision: connection.revision, key, ...(allowMissing ? { allowMissing: true } : {}) });
  if (result.key !== key) throw Error('Session object key mismatch.');
  if ('missing' in result) { if (!allowMissing || result.missing !== true) throw Error('Unexpected missing object.'); return undefined; }
  if (result.size > limit || result.base64.length > Math.ceil(limit / 3) * 4) throw Error('Session object exceeds the read limit.');
  const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
  if (bytes.length !== result.size) throw Error('Session object size mismatch.');
  return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, digest: await digest(bytes), bytes: bytes.length };
}

/** One immutable evidence-prefix cursor. No model, tools, or workflow effects. */
export class LiveSessionReader {
  nextChunk = 1; sequence = 0; loadedBytes = 0; lastObserved = ''; terminal?: z.infer<typeof terminalSchema>;
  readonly messages: LiveMessage[] = []; readonly nativeMessages: LiveMessage[] = []; readonly tools = new Map<string, LiveTool>();
  readonly sessions = new Map<string, { parentId?: string | null; role?: string }>();
  hasPi = false;
  private hashes = new Map<number, string>();
  private current = new Map<string, LiveMessage>();
  private parts = new Map<string, Map<number, string>>();
  private nextTerminalCheck = 0;
  private invalid?: unknown;
  constructor(readonly locator: LiveLocator, readonly key: string, private connection: PublicS3Connection, private send: Send = bridgeRequest) {}
  get settled() { return !!this.terminal && this.nextChunk === this.terminal.chunks + 1 && this.sequence === this.terminal.sequence; }
  get transcript() { return this.hasPi ? this.messages : this.nativeMessages; }
  private add(session: string, role: string, content: string, partial: boolean) {
    const list = this.messages;
    if (list.length >= 1000) throw Error('Session view reached its 1,000-message limit. History is incomplete.');
    const message = { id: `${session}:${list.length}`, session, role, text: content, partial }; list.push(message); return message;
  }
  private reduce(row: z.infer<typeof eventSchema>) {
    this.lastObserved = row.timestamp;
    if (row.sessionId) {
      if (!this.sessions.has(row.sessionId) && this.sessions.size >= 1000) throw Error('Session relationship view reached its 1,000-session limit.');
      const prior = this.sessions.get(row.sessionId);
      if (prior?.parentId !== undefined && row.parentId !== undefined && row.parentId !== prior.parentId) throw Error('Session parent identity changed.');
      this.sessions.set(row.sessionId, { parentId: row.parentId !== undefined ? row.parentId : prior?.parentId, role: row.role ?? prior?.role });
    }
    const data = object(row.data);
    if (row.kind === 'native') {
      const message = object(data.message);
      if (data.type === 'message' && typeof message.role === 'string') {
        if (this.nativeMessages.length >= 1000) throw Error('Native history reached its 1,000-message limit.');
        this.nativeMessages.push({ id: `native:${row.sequence}`, session: row.sessionId ?? '', role: message.role, text: text(message.content), partial: false });
      }
    }
    if (row.kind !== 'pi') return;
    if (!row.sessionId || typeof data.source !== 'string' || !/^(pi|resume|phase|worker)-events\.log$/.test(data.source)) throw Error('Invalid Pi event scope.');
    this.hasPi = true;
    const event = object(data.event), stream = `${row.sessionId}/${data.source}`, message = object(event.message);
    if (event.type === 'message_start') {
      const current = this.add(stream, typeof message.role === 'string' ? message.role : 'unknown', text(message.content), true);
      this.current.set(stream, current); this.parts.set(stream, new Map());
    } else if (event.type === 'message_update') {
      const current = this.current.get(stream), update = object(event.assistantMessageEvent), index = update.contentIndex;
      if (!current || !Number.isSafeInteger(index) || Number(index) < 0 || Number(index) > 1000) throw Error('Pi message update has no matching start or content block.');
      const parts = this.parts.get(stream)!;
      if (update.type === 'text_start') parts.set(Number(index), '');
      if (update.type === 'text_delta' && typeof update.delta === 'string') parts.set(Number(index), (parts.get(Number(index)) ?? '') + update.delta);
      if (update.type === 'text_end' && typeof update.content === 'string') parts.set(Number(index), update.content);
      current.text = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(p => p[1]).join('\n');
    } else if (event.type === 'message_end') {
      const current = this.current.get(stream) ?? this.add(stream, typeof message.role === 'string' ? message.role : 'unknown', '', false);
      current.role = typeof message.role === 'string' ? message.role : current.role; current.text = text(message.content); current.partial = false;
      this.current.delete(stream); this.parts.delete(stream);
    } else if (typeof event.toolCallId === 'string' && typeof event.toolName === 'string') {
      const id = `${stream}/${event.toolCallId}`;
      if (event.type === 'tool_execution_start') {
        if (this.tools.size >= 1000) throw Error('Session tool view reached its 1,000-call limit.');
        this.tools.set(id, { id, name: event.toolName, state: 'running', detail: '' });
      } else if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
        const tool = this.tools.get(id); if (!tool) throw Error('Tool update has no matching start.');
        tool.detail = text(object(event.partialResult ?? event.result).content);
        if (event.type === 'tool_execution_end') tool.state = event.isError ? 'failed' : 'completed';
      }
    }
    const chars = [...this.messages, ...this.nativeMessages].reduce((n, m) => n + m.text.length, 0) + [...this.tools.values()].reduce((n, t) => n + t.detail.length, 0);
    if (chars > 2_000_000) throw Error('Session transcript exceeds the 2 MB display limit. History is incomplete.');
  }
  async applyChunk(index: number, value: unknown, hash: string, bytes: number) {
    if (this.invalid) throw this.invalid;
    if (index < this.nextChunk) { if (this.hashes.get(index) !== hash) throw Error('Previously read session chunk changed.'); return; }
    if (index !== this.nextChunk || index > 16384) throw Error('Session chunk gap or chunk limit exceeded.');
    const chunk = chunkSchema.parse(value);
    if (!sameBinding(chunk.binding, this.locator.binding) || chunk.executionId !== this.locator.executionId) throw Error('Session chunk identity mismatch.');
    if (this.loadedBytes + bytes > 64_000_000) throw Error('Session replay exceeds the 64 MB view limit. History is incomplete.');
    let expected = this.sequence;
    for (const row of chunk.events) if (row.sequence !== ++expected) throw Error('Session event sequence gap.');
    // Validation precedes reduction. A reduction-limit error stops this reader;
    // it is never retried against partially applied state.
    try { for (const row of chunk.events) this.reduce(row); }
    catch (error) { this.invalid = error; throw error; }
    this.sequence = expected; this.loadedBytes += bytes; this.hashes.set(index, hash); this.nextChunk++;
  }
  async poll(active: () => boolean = () => true) {
    if (this.invalid) throw this.invalid;
    if (this.settled) return;
    for (let count = 0; count < 8 && active(); count++) {
      const index = this.nextChunk, key = `${this.locator.evidencePrefix}chunks/${String(index).padStart(6, '0')}.json`;
      const chunk = await readJson(this.send, this.connection, key, 4_100_000, true); if (!active()) return;
      if (!chunk) break;
      await this.applyChunk(index, chunk.value, chunk.digest, chunk.bytes);
      if (this.terminal && index >= this.terminal.chunks) break;
    }
    if (!active()) return;
    if (!this.terminal && Date.now() >= this.nextTerminalCheck) {
      this.nextTerminalCheck = Date.now() + 5000;
      const result = await readJson(this.send, this.connection, this.locator.evidencePrefix + 'terminal.json', 32768, true); if (!active()) return;
      if (result) {
        const terminal = terminalSchema.parse(result.value);
        if (!sameBinding(terminal.binding, this.locator.binding) || terminal.executionId !== this.locator.executionId || terminal.command !== this.locator.command) throw Error('Session terminal identity mismatch.');
        this.terminal = terminal;
      }
    }
    if (this.terminal && (this.nextChunk > this.terminal.chunks + 1 || this.sequence > this.terminal.sequence || this.nextChunk === this.terminal.chunks + 1 && this.sequence !== this.terminal.sequence)) throw Error('Session terminal disagrees with published events.');
  }
}

export class RemoteSessions {
  stores: PublicS3Connection[] = []; storage = ''; root = 'qrspi/qrspi-hosted/'; selected = '';
  locators: { key: string; value: LiveLocator }[] = []; reader?: LiveSessionReader;
  error = ''; busy = false; following = false;
  private generation = 0; private timer?: ReturnType<typeof setTimeout>; private listeners = new Set<() => void>();
  constructor(readonly scope?: Scope, private send: Send = bridgeRequest) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }
  edit(key: 'storage' | 'root' | 'selected', value: string) { this.stop(); this[key] = value; this.reader = undefined; if (key !== 'selected') this.locators = []; this.error = ''; this.notify(); }
  async run(work: () => Promise<void>) { if (this.busy) return; this.busy = true; this.error = ''; this.notify(); try { await work(); } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.stop(); } finally { this.busy = false; this.notify(); } }
  private connection() { const connection = this.stores.find(s => s.id === this.storage); if (!connection?.allowRead) throw Error('Select a read-enabled Actions S3 connection.'); return connection; }
  async connect() {
    let support: { capabilities: string[] };
    try { support = await this.send({ operation: 's3Capabilities' }); }
    catch { throw Error('Live-session storage capabilities are unavailable. Update and reload the extension/native host, then reload this page.'); }
    if (!support.capabilities?.includes('s3AllowMissing')) throw Error('Update and reload the extension/native host for live session reads.');
    const stores = await this.send<PublicS3Connection[]>({ operation: 's3Connections' });
    const old = this.stores.find(s => s.id === this.storage), next = stores.find(s => s.id === this.storage);
    if (old && (!next || next.revision !== old.revision)) { this.stop(); this.reader = undefined; this.locators = []; }
    this.stores = stores;
  }
  async discover() {
    this.stop();
    if (!this.scope || !repository.safeParse(this.scope.repository).success || !/^[\w-]{1,200}$/.test(this.scope.workspace)) throw Error('Open Agent from the selected workspace to discover remote sessions.');
    const connection = this.connection(), root = s3Prefix(this.root), prefix = `${root}live/${this.scope.repository.toLowerCase()}/${this.scope.workspace}/`;
    if (!prefix.startsWith(connection.prefix)) throw Error('Actions storage root is outside the approved S3 prefix.');
    const direct = !this.locators.length && !!this.selected;
    if (direct && !this.selected.startsWith(prefix)) throw Error('Session link is outside the selected workspace inventory.');
    let token: string | undefined; const found: { key: string; value: LiveLocator }[] = [];
    for (let page = 0; page < 10; page++) {
      const result: S3Listing = direct ? { objects: [{ key: this.selected, size: 0 }] } : await this.send({ operation: 's3List', id: connection.id, revision: connection.revision, prefix, continuationToken: token });
      for (const item of result.objects) {
        if (!item.key.startsWith(prefix)) throw Error('Session inventory escaped the selected workspace.');
        const suffix = item.key.slice(prefix.length);
        if (!/^[1-9]\d{0,15}-[1-9]\d{0,15}\/(open|work)\.json$/.test(suffix)) throw Error('Unexpected session inventory key.');
        if (item.size > 32768) throw Error('Session locator exceeds 32 KB.');
        const result = await readJson(this.send, connection, item.key, 32768);
        const value = liveLocatorSchema.parse(result!.value);
        if (value.binding.workspace !== this.scope.workspace || value.storageRepository.toLowerCase() !== this.scope.repository.toLowerCase() || suffix !== `${value.executionId}/${value.command}.json`) throw Error('Session locator identity mismatch.');
        if (!value.evidencePrefix.startsWith(root + 'processes/') || !new RegExp(`/executions/${value.executionId}/${value.command}/$`).test(value.evidencePrefix)) throw Error('Session evidence locator is outside its invocation.');
        s3Key(value.evidencePrefix);
        if (found.some(row => row.value.binding.workspace_ref !== value.binding.workspace_ref)) throw Error('Session inventory has inconsistent workspace identities.');
        found.push({ key: item.key, value });
        if (found.length > 100) throw Error('Session inventory exceeds 100 entries; narrow the Actions storage root or use a paginated index.');
      }
      token = result.continuationToken; if (!token) break;
    }
    if (token) throw Error('Session inventory pagination is incomplete.');
    this.locators = found.sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt));
    if (!found.some(row => row.key === this.selected)) { this.selected = ''; this.reader = undefined; }
  }
  async follow() {
    this.stop(); const connection = this.connection(), selected = this.locators.find(row => row.key === this.selected);
    if (!selected) throw Error('Select a remote session.');
    this.reader ??= new LiveSessionReader(selected.value, selected.key, connection, this.send);
    this.following = true; const generation = this.generation;
    const active = () => this.following && generation === this.generation;
    const tick = async () => {
      if (!active()) return;
      try {
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') await this.reader!.poll(active);
        if (!active()) return;
        this.notify(); if (this.reader!.settled) { this.stop(); return; }
        const idle = Date.now() - Date.parse(this.reader!.lastObserved || '1970-01-01') > 15000;
        this.timer = setTimeout(() => { void tick(); }, idle ? 3000 : 1000);
      } catch (error) { if (active()) { this.error = error instanceof Error ? error.message : String(error); this.stop(); this.notify(); } }
    };
    await tick();
  }
  stop() { this.following = false; this.generation++; clearTimeout(this.timer); this.notify(); }
  dispose() { this.stop(); this.listeners.clear(); }
}

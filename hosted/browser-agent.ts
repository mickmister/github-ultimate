import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { bridgeRequest } from './client';
import { browserPiAgent } from './pi-agent';
import { workspaceAgentTools } from './pi-workspace-agent';
import { executeScratch } from './scratch-execution';
import { PiSessions, type SessionBinding } from './pi-session';
import { Scratch, type ScratchState, type ScratchEntry } from '../src/scratch';
import { verifiedGitBlobBytes, type GitBlob } from '../src/git-reads';
import { beadsAgent } from './beads-agent';
import type { BeadsPin } from './beads-sample';
import type { HostedConnection } from '../src/hosted-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection, S3Listing } from '../src/s3-protocol';
import { backblaze, checkpointReference } from '../src/s3-protocol';

export interface AgentFields { inference: string; github: string; storage: string; session: string; checkpoint: string; repository: string; commit: string; directory: string; prompt: string; script: string; message: string }
export class BrowserAgent {
  fields: AgentFields = { inference: '', github: '', storage: '', session: '', checkpoint: '', repository: '', commit: '', directory: '', prompt: '', script: '', message: '' };
  inferences: PublicInferenceConnection[] = []; githubs: HostedConnection[] = []; stores: PublicS3Connection[] = [];
  checkpoints: string[] = []; token?: string; parent: string | null = null;
  busy = false; dirty = false; status = ''; error = ''; output = ''; scratch?: Scratch;
  runtime?: ReturnType<typeof browserPiAgent>; private abort?: AbortController; private disposeAgent?: () => void;
  private listeners = new Set<() => void>();
  private disposeBeads?: () => void;
  private beads?: ReturnType<typeof beadsAgent>;
  constructor(private send: typeof bridgeRequest = bridgeRequest, readonly workspace?: { repository: string; workspace: string }) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) listener(); }
  edit(key: keyof AgentFields, value: string) {
    if (this.busy || this.dirty) return;
    this.fields = { ...this.fields, [key]: value };
    if (['inference', 'github', 'storage', 'session'].includes(key)) { this.disposeAgent?.(); this.disposeBeads?.(); this.runtime = undefined; this.scratch = undefined; this.parent = null; this.checkpoints = []; this.token = undefined; }
    this.notify();
  }
  async run(work: () => Promise<void>) {
    if (this.busy) return; this.busy = true; this.error = ''; this.notify();
    try { await work(); } catch (error) { this.error = error instanceof Error ? error.message : 'Agent operation failed.'; }
    finally { this.busy = false; this.notify(); }
  }
  async connect() {
    if (this.dirty) throw Error('Save this session before changing connections.');
    const support = await this.send<{ capabilities: string[] }>({ operation: 'discover' });
    if (!['agentGraphql', 'agentTree', 'agentBlob', 's3Checkpoint'].every(capability => support.capabilities?.includes(capability))) throw Error('Update and reload the extension/native host for lazy workspaces, GraphQL and versioned checkpoints, then reload this page.');
    const [inferences, githubs, stores] = await Promise.all([this.send<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }), this.send<HostedConnection[]>({ operation: 'connections' }), this.send<PublicS3Connection[]>({ operation: 's3Connections' })]);
    this.inferences = inferences; this.githubs = githubs; this.stores = stores; this.status = 'Connections loaded.';
  }
  private configure() {
    const inference = this.inferences.find(x => x.id === this.fields.inference), github = this.githubs.find(x => x.id === this.fields.github), storage = this.stores.find(x => x.id === this.fields.storage);
    if (!inference || !github?.user || !github.installation || !storage?.allowRead || !storage.allowUpload || storage.allowOverwrite) throw Error('Select inference, signed-in GitHub and S3 connections. S3 needs reads/uploads enabled and overwrites disabled.');
    const binding: SessionBinding = { runtime: 'earendil-pi-1.5.2-text-v1', inferenceModel: inference.model, githubAppId: github.appId, githubUserId: github.user.id, installationId: github.installation.id, storageEndpoint: new URL(storage.endpoint).href, storageBucket: storage.bucket, storagePrefix: storage.prefix, storageRegion: storage.region, storageAddressing: storage.addressing };
    if (this.workspace) binding.beads = this.workspace;
    return { inference, github, storage, binding, sessions: new PiSessions(this.send, storage) };
  }
  private start(scratch: Scratch, messages: AgentMessage[] = [], pinnedBeads?: BeadsPin) {
    const { inference, github } = this.configure(); this.disposeAgent?.(); this.scratch = scratch;
    this.disposeBeads?.();
    const beads = beadsAgent(this.workspace ? { ...this.workspace, connectionId: github.id, installationId: github.installation!.id } : undefined, github.user!.id, this.send, undefined, pinnedBeads);
    this.beads = beads;
    this.disposeBeads = beads.dispose;
    this.runtime = browserPiAgent(this.send, inference, github, messages, [...workspaceAgentTools(scratch), beads.tool]);
    this.disposeAgent = this.runtime.agent.subscribe(() => this.notify());
  }
  async create(importRepository: boolean) {
    if (this.dirty) throw Error('Save this session first.');
    const { github } = this.configure(); let scratch = new Scratch();
    if (importRepository) scratch = this.openScratch(await this.send<ScratchState>({ operation: 'agentSnapshot', id: github.id, installationId: github.installation!.id, userId: github.user!.id, repository: this.fields.repository, commit: this.fields.commit, directory: this.fields.directory }));
    else scratch.commit('Initialize empty scratch workspace', 0, null);
    this.fields = { ...this.fields, session: crypto.randomUUID(), checkpoint: '' }; this.parent = null; this.checkpoints = []; this.token = undefined;
    this.start(scratch); this.dirty = true; await this.save();
  }
  async save() {
    if (!this.runtime || !this.scratch) throw Error('Create or restore a session first.');
    const { sessions, binding } = this.configure(); this.dirty = true;
    this.parent = await sessions.save(this.fields.session, binding, this.runtime.agent.state.messages, this.parent, this.scratch.snapshot(), this.beads?.snapshot());
    this.dirty = false; this.status = `Saved and readback-verified: ${this.parent}`;
  }
  async list(more = false) {
    if (this.dirty) throw Error('Save this session first.');
    const { sessions, storage } = this.configure();
    const listing = await this.send<S3Listing>({ operation: 's3List', id: storage.id, revision: storage.revision, prefix: sessions.prefix(this.fields.session), continuationToken: more ? this.token : undefined, versions: backblaze(storage.endpoint) });
    this.checkpoints = [...(more ? this.checkpoints : []), ...listing.objects.filter(x => x.key.endsWith('.json')).map(x => checkpointReference(x.key, x.versionId))]; this.token = listing.continuationToken;
  }
  async restore() {
    if (this.dirty) throw Error('Save this session first.');
    const { sessions, binding } = this.configure();
    const checkpoint = await sessions.read(this.fields.checkpoint, this.fields.session, binding);
    const scratch = this.openScratch(checkpoint.scratch); this.start(scratch, checkpoint.messages, checkpoint.beads); this.parent = this.fields.checkpoint; this.status = 'Session and scratch workspace restored. No tools replayed.';
  }
  private openScratch(state?: ScratchState) {
    const { github } = this.configure(), scope = { id: github.id, installationId: github.installation!.id, userId: github.user!.id, repository: state?.origin?.repository ?? this.fields.repository };
    return new Scratch(state, {
      tree: oid => this.send<ScratchEntry[]>({ operation: 'agentTree', ...scope, oid }),
      blob: async oid => { const blob = await this.send<GitBlob>({ operation: 'agentBlob', ...scope, oid }); const bytes = verifiedGitBlobBytes(blob); return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); },
    });
  }
  async prompt() {
    if (this.dirty || !this.runtime) throw Error('Create, restore or save this session first.');
    const text = this.fields.prompt.trim(); if (!text) return;
    this.runtime.resetBudget(); this.dirty = true; this.fields = { ...this.fields, prompt: '' };
    await this.runtime.agent.prompt(text); await this.save();
  }
  async script() {
    if (this.dirty || !this.scratch) throw Error('Create, restore or save this session first.');
    this.abort = new AbortController();
    try { const result = await executeScratch(this.scratch, this.fields.script, this.abort.signal); this.output = JSON.stringify(result, null, 2); if (result.ok) { this.dirty = true; await this.save(); } }
    finally { this.abort = undefined; }
  }
  async commit() {
    if (this.dirty || !this.scratch) throw Error('Save this session first.');
    this.scratch.commit(this.fields.message, this.scratch.revision, this.scratch.head); this.dirty = true; await this.save();
  }
  async diff() {
    if (!this.scratch) throw Error('Create or restore a session first.');
    this.output = JSON.stringify(await this.scratch.inspectDiff(), null, 2);
  }
  stop() { this.runtime?.agent.abort(); this.abort?.abort(); }
  dispose() { this.stop(); this.disposeAgent?.(); this.disposeBeads?.(); this.listeners.clear(); }
  transcript() { return (this.runtime?.agent.state.messages ?? []).filter(x => x.role !== 'system').map(x => `${x.role}: ${typeof x.content === 'string' ? x.content : x.content.map(p => p.type === 'text' ? p.text : JSON.stringify(p)).join('\n')}${x.role === 'assistant' && x.errorMessage ? `\n${x.errorMessage}` : ''}`).join('\n\n'); }
}

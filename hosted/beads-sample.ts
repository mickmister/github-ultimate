import { bridgeRequest } from './client';
import { WorkspaceReader, documentText, type GitTransport } from './workspaces';

// Updated only with a verified immutable release; workspace metadata cannot select executable code.
export const beadsRelease = {
  baseURL: 'https://browser-tools.alohak.dev/beads-engine/commits/4123ae678498ad611d39b7ef6569bb79d359df71/',
  manifestSha256: 'e7bafae0ef2471cad03b8c1957753a3949c1322cb01a0020a874360979c8b492',
};
export type BeadsScope = { connectionId: string; installationId: number; repository: string; workspace: string };
export type BeadsOperation = 'list' | 'ready' | 'blocked';
export type BeadsIssue = Record<string, unknown>;
export type BeadsResult = { operation: BeadsOperation; request: unknown; issues: BeadsIssue[] | null; durationMs: number };
type FileReference = { url: string; size: number; sha256: string };
type Engine = {
  open(snapshot: { apiVersion: 1; manifest: FileReference; files: FileReference[] }, signal?: AbortSignal): Promise<{ commit: string; root: string }>;
  query(request: unknown, signal?: AbortSignal): Promise<{ issues: BeadsIssue[] | null }>;
  state(signal?: AbortSignal): Promise<{ putRejected: boolean; commitRejected: boolean; sealed: boolean; heapAllocBytes: number; heapSysBytes: number }>;
  dispose(): void;
};
type EngineModule = { BeadsBrowserEngine: { create(options: { baseURL: string; expectedManifestSha256: string; timeoutMs: number }): Promise<Engine> } };
const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function asset(path: string, signal: AbortSignal) {
  const response = await fetch(beadsRelease.baseURL + path, { credentials: 'omit', signal });
  if (!response.ok || !response.body) throw new Error(`Engine ${path} request failed (${response.status}).`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > 256 * 1024) throw new Error('Engine metadata exceeds its bound.'); chunks.push(value.value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}

async function createEngine(signal: AbortSignal) {
  const bytes = await asset('manifest.json', signal);
  if (await digest(bytes) !== beadsRelease.manifestSha256) throw new Error('Engine release manifest failed integrity verification.');
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  const entry = manifest.files?.find((file: { path: string }) => file.path === 'client.js');
  const client = await asset('client.js', signal);
  if (!entry || entry.size !== client.length || entry.sha256 !== await digest(client)) throw new Error('Engine client failed integrity verification.');
  const url = URL.createObjectURL(new Blob([client], { type: 'application/javascript' }));
  try {
    const module = await import(/* @vite-ignore */ url) as EngineModule;
    signal.throwIfAborted();
    return await module.BeadsBrowserEngine.create({ baseURL: beadsRelease.baseURL, expectedManifestSha256: beadsRelease.manifestSha256, timeoutMs: 180000 });
  } finally { URL.revokeObjectURL(url); }
}

export async function openBeadsSample(scope: BeadsScope, signal: AbortSignal, progress: (message: string) => void, send: GitTransport = bridgeRequest) {
  const urls: string[] = []; let engine: Engine | undefined;
  const dispose = () => { engine?.dispose(); for (const url of urls.splice(0)) URL.revokeObjectURL(url); };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    progress('Discovering the selected workspace and verifying its manifest…');
    const reader = new WorkspaceReader(send, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
    const workspace = (await reader.discover()).find(value => value.name === scope.workspace);
    if (!workspace?.dolt) throw new Error('The selected workspace has no published native Beads/Dolt snapshot.');
    await reader.open(workspace);
    const native = new WorkspaceReader(send, scope.connectionId, scope.repository, scope.installationId, scope.workspace, 'dolt');
    const snapshot = await native.snapshot(workspace.dolt, true);
    const manifest = snapshot.tree.tree.find(entry => entry.path === 'manifest');
    if (!manifest) throw new Error('Native storage snapshot has no manifest.');
    const entries = snapshot.tree.tree.filter(entry => entry.type === 'blob' && /^(?:oldgen\/)?[0-9a-v]{32}(?:\.darc)?$/.test(entry.path));
    const total = entries.reduce((sum, entry) => sum + (entry.size ?? Infinity), 0);
    if (!entries.length || entries.length > 512 || total > 64 * 1024 * 1024) throw new Error('Native snapshot exceeds the engine’s 64 MiB encoded-data bound.');
    if (entries.some(entry => (entry.size ?? Infinity) > 16 * 1024 * 1024)) {
      const support = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' });
      if (!support.capabilities.includes('gitBlobPart')) throw new Error('This snapshot contains a large archive. Update the extension or Alohak to enable bounded Dolt blob reads, then reload.');
    }
    async function reference(entry: NonNullable<typeof manifest>): Promise<FileReference> {
      signal.throwIfAborted();
      const bytes = await native.blob(entry, signal), url = URL.createObjectURL(new Blob([bytes])); urls.push(url);
      return { url, size: bytes.length, sha256: await digest(bytes) };
    }
    const manifestReference = await reference(manifest);
    const fields = documentText(new Uint8Array(await (await fetch(manifestReference.url)).arrayBuffer())).trim().split(':');
    if (fields[0] !== '5' || fields[1] !== '__DOLT__' || !/^[0-9a-v]{32}$/.test(fields[3] ?? '')) throw new Error('Unsupported native Dolt manifest.');
    const files: FileReference[] = [];
    for (const [index, entry] of entries.entries()) {
      progress(`Verifying native file ${index + 1}/${entries.length} · ${entry.path} · ${(entry.size! / 1048576).toFixed(1)} MiB`);
      files.push(await reference(entry));
    }
    progress('Loading the integrity-pinned WASM engine and decoding native Dolt chunks…');
    engine = await createEngine(signal); signal.throwIfAborted();
    const opened = await engine.open({ apiVersion: 1, manifest: manifestReference, files }, signal);
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    const runtime = engine;
    return {
      gitCommit: snapshot.commit, doltCommit: opened.commit, root: opened.root, storageRoot: fields[3], fileCount: files.length, encodedBytes: total,
      async query(operation: BeadsOperation): Promise<BeadsResult> {
        const request = operation === 'list' ? { operation, issueFilter: { SortBy: 'priority', Limit: 50 } }
          : operation === 'ready' ? { operation, workFilter: { Status: 'open', SortPolicy: 'priority' } } : { operation, workFilter: {} };
        const start = performance.now(), response = await runtime.query(request, signal);
        return { operation, request, issues: response.issues, durationMs: Math.round(performance.now() - start) };
      },
      state: () => runtime.state(signal),
      dispose() { signal.removeEventListener('abort', dispose); dispose(); },
    };
  } catch (error) { signal.removeEventListener('abort', dispose); dispose(); throw error; }
}
export type BeadsSession = Awaited<ReturnType<typeof openBeadsSample>>;

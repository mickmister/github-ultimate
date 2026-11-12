import type { GitBlob, GitCommit, GitRead, GitRef, GitTree } from '../src/git-reads';
import { parseWorkspaceManifest } from './manifest';

export type Workspace = { name: string; documents?: string; dolt?: string };
export type GitTransport = <T>(request: GitRead) => Promise<T>;
export type Snapshot = { commit: string; tree: GitTree };
const maxBlobBytes = 16 * 1024 * 1024;

export class WorkspaceReader {
  constructor(private send: GitTransport, private id: string, private repository: string, private installationId: number, private workspace?: string, private namespace: 'documents' | 'dolt' = 'documents') {}
  private read<T>(request: Omit<GitRead, 'id' | 'repository' | 'installationId' | 'workspace'> & { prefix?: 'documents/' | 'dolt/'; oid?: string }) {
    if (request.operation !== 'gitRefs' && !this.workspace) throw new Error('Select a workspace first.');
    return this.send<T>({ ...(this.namespace === 'dolt' ? { namespace: this.namespace } : {}), ...request, id: this.id, installationId: this.installationId, repository: this.repository, ...(request.operation !== 'gitRefs' ? { workspace: this.workspace } : {}) } as GitRead);
  }
  async discover(progress?: (prefix: 'documents/' | 'dolt/') => void): Promise<Workspace[]> {
    const workspaces = new Map<string, Workspace>();
    // Matching refs is GitHub's complete, non-paginated custom-ref endpoint.
    // Keep distinct namespaces distinct; machine-local attachments aren't a
    // remotely available registry and a ref name isn't a workspace UUID.
    for (const prefix of ['documents/', 'dolt/'] as const) {
      progress?.(prefix);
      const refs = await this.read<GitRef[]>({ operation: 'gitRefs', prefix });
      for (const ref of refs) {
        if (!ref.ref.startsWith(`refs/${prefix}`)) throw new Error('Unexpected workspace ref namespace.');
        const name = ref.ref.slice(`refs/${prefix}`.length);
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(name)) continue;
        const workspace = workspaces.get(name) ?? { name };
        workspace[prefix === 'documents/' ? 'documents' : 'dolt'] = ref.object.sha;
        workspaces.set(name, workspace);
      }
    }
    return [...workspaces.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  async snapshot(oid: string, visit = false): Promise<Snapshot> {
    const commit = await this.read<GitCommit>({ operation: 'gitCommit', oid, ...(visit ? { cacheVisit: true } : {}) });
    if (commit.sha !== oid) throw new Error('Snapshot commit identity mismatch.');
    const tree = await this.read<GitTree>({ operation: 'gitTree', oid: commit.tree.sha });
    if (tree.truncated || tree.sha !== commit.tree.sha) throw new Error('Incomplete or mismatched snapshot tree.');
    return { commit: oid, tree };
  }
  async open(workspace: Workspace) {
    if (!workspace.documents || workspace.name !== this.workspace) throw new Error('Workspace manifest is required: this namespace has no matching documents ref.');
    const snapshot = await this.snapshot(workspace.documents);
    const entry = documents(snapshot).find(entry => entry.path === 'documents/workspace/manifest.json');
    if (!entry) throw new Error('Workspace manifest is required. Provision workspace/manifest.json with repositories or a purpose.');
    const manifest = parseWorkspaceManifest(documentText(await this.blob(entry)), workspace.name);
    return { snapshot, manifest, version: entry.sha };
  }
  async blob(entry: GitTree['tree'][number]): Promise<Uint8Array<ArrayBuffer>> {
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new Error('Only regular files can be read.');
    if (entry.size === undefined || entry.size > maxBlobBytes) throw new Error('File exceeds the 16 MiB read limit or has no size.');
    const blob = await this.read<GitBlob>({ operation: 'gitBlob', oid: entry.sha });
    if (blob.encoding !== 'base64' || blob.size !== entry.size || blob.sha !== entry.sha || blob.content.length > 24 * 1024 * 1024) throw new Error('Git blob metadata mismatch.');
    const binary = atob(blob.content.replace(/\s/g, ''));
    if (binary.length !== entry.size) throw new Error('Git blob size mismatch.');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const object = new Uint8Array(header.length + bytes.length);
    object.set(header); object.set(bytes, header.length);
    const hash = await crypto.subtle.digest(entry.sha.length === 40 ? 'SHA-1' : 'SHA-256', object);
    const actual = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== entry.sha) throw new Error('Git blob bytes failed integrity verification.');
    return bytes;
  }
}

export function documents(snapshot: Snapshot) {
  return snapshot.tree.tree.filter(entry => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) && entry.path.startsWith('documents/'))
    .sort((a,b) => a.path.localeCompare(b.path));
}

export function documentText(bytes: Uint8Array<ArrayBuffer>): string {
  if (bytes.includes(0)) throw new Error('Binary document: text preview is unavailable.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Document is not UTF-8 text.'); }
}

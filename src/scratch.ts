import { z } from 'zod';
import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import { applyPatch, createTwoFilesPatch } from 'diff';

// The broker also runs in Hermes, where TextEncoder is not guaranteed.
const encoder = { encode(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (const character of value) {
    let code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return Uint8Array.from(bytes);
} };
export const scratchPath = z.string().min(1).max(512).refine(path => !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'), 'Use a relative file path outside .git.');
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const file = z.object({ path: scratchPath, content: z.string().max(128 * 1024), mode: z.enum(['100644', '100755']) }).strict();
const files = z.array(file).max(100);
export const scratchEntrySchema = z.object({ name: scratchPath.refine(p => !p.includes('/')), mode: z.enum(['100644', '100755', '40000', '120000', '160000']), oid, type: z.enum(['blob', 'tree', 'commit']), size: z.number().int().nonnegative().optional() }).strict();
export type ScratchEntry = z.infer<typeof scratchEntrySchema>;
const deleted = z.array(scratchPath).max(100).optional();
const base = z.object({ tree: oid, trees: z.record(oid, z.array(scratchEntrySchema).max(10000)) }).strict();
export type ScratchLoader = { tree(oid: string): Promise<ScratchEntry[]>; blob(oid: string): Promise<string> };
export const scratchSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  origin: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), commit: oid, directory: z.string().max(512) }).strict().nullable(),
  base: base.optional(), deleted,
  files, commits: z.array(z.object({ oid, tree: oid, parent: oid.nullable(), body: z.string().max(32 * 1024), files, deleted }).strict()).max(30),
}).strict();
export type ScratchState = z.infer<typeof scratchSchema>;
export type ScratchFile = z.infer<typeof file>;
export function gitObject(type: 'blob' | 'tree' | 'commit', content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  return bytesToHex(sha1(concatBytes(encoder.encode(`${type} ${bytes.length}\0`), bytes)));
}
export function validateFiles(input: ScratchFile[]) {
  files.parse(input);
  const paths = new Set<string>(); let bytes = 0;
  for (const entry of input) {
    if (paths.has(entry.path)) throw Error('Duplicate scratch path.');
    paths.add(entry.path); bytes += encoder.encode(entry.content).length;
    if (encoder.encode(entry.content).length > 128 * 1024 || entry.content.includes('\0')) throw Error('Scratch files must be UTF-8 text up to 128 KiB.');
  }
  for (const path of paths) { const parts = path.split('/'); while (parts.length > 1) { parts.pop(); if (paths.has(parts.join('/'))) throw Error('Scratch file/directory collision.'); } }
  if (bytes > 512 * 1024) throw Error('Scratch working tree exceeds 512 KiB.');
  return input;
}
export function gitTreeEntries(entries: Pick<ScratchEntry, 'name' | 'mode' | 'oid'>[]) {
  const sorted = [...entries].sort((a, b) => { const x = encoder.encode(a.name + (a.mode === '40000' ? '/' : '')), y = encoder.encode(b.name + (b.mode === '40000' ? '/' : '')); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; });
  return gitObject('tree', concatBytes(...sorted.map(r => concatBytes(encoder.encode(`${r.mode} ${r.name}\0`), hexToBytes(r.oid)))));
}
function overlayTree(state: Pick<ScratchState, 'base' | 'files' | 'deleted'>): string {
  if (!state.base) return scratchTree(state.files);
  const changes = [...state.files.map(f => f.path), ...(state.deleted ?? [])];
  function build(tree: string | undefined, prefix: string): string {
    if (tree && !changes.some(p => p.startsWith(prefix))) return tree;
    const entries = new Map((tree ? state.base!.trees[tree] : [])?.map(e => [e.name, e]));
    if (tree && !state.base!.trees[tree]) throw Error('Directory metadata must be loaded before committing changes.');
    const names = new Set(changes.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]));
    for (const name of names) {
      const path = prefix + name, original = entries.get(name), changed = state.files.find(f => f.path === path);
      if (changed) entries.set(name, { name, mode: changed.mode, oid: gitObject('blob', changed.content), type: 'blob' });
      else if (state.deleted?.includes(path)) entries.delete(name);
      else entries.set(name, { name, mode: '40000', type: 'tree', oid: build(original?.type === 'tree' ? original.oid : undefined, path + '/') });
    }
    return gitTreeEntries([...entries.values()]);
  }
  return build(state.base.tree, '');
}
// Native Git object encoding. Scratch is a separate repository: a directory
// import records its upstream pin without fabricating full-repository ancestry.
export function scratchTree(input: ScratchFile[]): string {
  validateFiles(input);
  function tree(entries: ScratchFile[]): string {
    const children = new Map<string, ScratchFile[]>(), records: { name: string; mode: string; oid: string }[] = [];
    for (const entry of entries) {
      const slash = entry.path.indexOf('/');
      if (slash < 0) records.push({ name: entry.path, mode: entry.mode, oid: gitObject('blob', entry.content) });
      else { const name = entry.path.slice(0, slash), group = children.get(name) ?? []; group.push({ ...entry, path: entry.path.slice(slash + 1) }); children.set(name, group); }
    }
    for (const [name, group] of children) records.push({ name, mode: '40000', oid: tree(group) });
    records.sort((a, b) => { const x = encoder.encode(a.name + (a.mode === '40000' ? '/' : '')), y = encoder.encode(b.name + (b.mode === '40000' ? '/' : '')); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; });
    return gitObject('tree', concatBytes(...records.map(r => concatBytes(encoder.encode(`${r.mode} ${r.name}\0`), hexToBytes(r.oid)))));
  }
  return tree(input);
}
export class Scratch {
  private state: ScratchState;
  private blobs = new Map<string, string>();
  constructor(state: ScratchState = { version: 1, revision: 0, origin: null, files: [], commits: [] }, readonly loader?: ScratchLoader) {
    this.state = structuredClone(scratchSchema.parse(state)); validateFiles(this.state.files);
    if (this.state.base) {
      if (!this.state.origin || !this.state.base.trees[this.state.base.tree]) throw Error('Lazy workspace is missing its pinned base.');
      for (const [oid, entries] of Object.entries(this.state.base.trees)) {
        if (new Set(entries.map(e => e.name)).size !== entries.length || gitTreeEntries(entries) !== oid || entries.some(e => e.type !== (e.mode === '40000' ? 'tree' : e.mode === '160000' ? 'commit' : 'blob'))) throw Error('Invalid base tree integrity.');
      }
    }
    const validateOverlay = (version: Pick<ScratchState, 'files' | 'deleted'>) => {
      if (new Set(version.deleted).size !== (version.deleted?.length ?? 0) || version.files.some(f => version.deleted?.includes(f.path))) throw Error('Invalid deleted-file overlay.');
      for (const path of [...version.files.map(f => f.path), ...(version.deleted ?? [])]) {
        const entry = this.baseEntry(path);
        if (entry && !['100644', '100755'].includes(entry.mode)) throw Error('Overlay cannot replace directories, symlinks or submodules.');
        if (version.deleted?.includes(path) && !entry) throw Error('Deleted base file does not exist.');
        const parts = path.split('/'); while (parts.length > 1) { parts.pop(); const parent = this.baseEntry(parts.join('/')); if (parent && parent.type !== 'tree') throw Error('Overlay file/directory collision.'); }
      }
    };
    validateOverlay(this.state);
    let parent: string | null = null;
    for (const commit of this.state.commits) {
      validateFiles(commit.files);
      validateOverlay(commit);
      if (commit.parent !== parent || overlayTree({ ...commit, base: this.state.base }) !== commit.tree || gitObject('commit', commit.body) !== commit.oid || !commit.body.startsWith(`tree ${commit.tree}\n${parent ? `parent ${parent}\n` : ''}author Browser Pi <scratch@localhost> `)) throw Error('Invalid scratch commit history.');
      parent = commit.oid;
    }
    if (encoder.encode(JSON.stringify(this.state)).length > 2 * 1024 * 1024) throw Error('Scratch history exceeds 2 MiB.');
  }
  snapshot() { return structuredClone(this.state); }
  get revision() { return this.state.revision; }
  get head() { return this.state.commits.at(-1)?.oid ?? null; }
  private baseEntry(path: string): ScratchEntry | undefined {
    let tree = this.state.base?.tree, entry: ScratchEntry | undefined;
    for (const part of path.split('/')) { if (!tree) return; const entries = this.state.base!.trees[tree]; if (!entries) throw Error('Directory metadata is not loaded.'); entry = entries.find(e => e.name === part); tree = entry?.type === 'tree' ? entry.oid : undefined; }
    return entry;
  }
  async prepare(path: string, contents: boolean | 'base' = false, directory = false) {
    if (path !== '.') scratchPath.parse(path);
    let tree = this.state.base?.tree;
    const parts = path === '.' ? [] : path.split('/');
    for (let i = 0; tree; i++) {
      if (!this.state.base!.trees[tree]) {
        if (!this.loader) throw Error('Reconnect GitHub to load directory metadata.');
        const entries = z.array(scratchEntrySchema).max(10000).parse(await this.loader.tree(tree));
        if (gitTreeEntries(entries) !== tree || new Set(entries.map(e => e.name)).size !== entries.length) throw Error('Directory integrity mismatch.');
        this.state.base!.trees[tree] = entries;
        if (encoder.encode(JSON.stringify(this.state)).length > 2 * 1024 * 1024) { delete this.state.base!.trees[tree]; throw Error('Workspace metadata exceeds 2 MiB. Narrow the directory scope.'); }
      }
      if (i === parts.length) break;
      const entry = this.state.base!.trees[tree].find(e => e.name === parts[i]);
      tree = entry?.type === 'tree' && (directory || i < parts.length - 1) ? entry.oid : undefined;
    }
    if (contents && this.state.base && (contents === 'base' || !this.state.files.some(f => f.path === path) && !this.state.deleted?.includes(path))) {
      const entry = this.baseEntry(path);
      if (entry && entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) && !this.blobs.has(entry.oid)) {
        if ((entry.size ?? Infinity) > 128 * 1024) throw Error('File exceeds the 128 KiB text-read limit.');
        if (!this.loader) throw Error('Reconnect GitHub to read this base file.');
        const content = await this.loader.blob(entry.oid);
        if (gitObject('blob', content) !== entry.oid || encoder.encode(content).length > 128 * 1024 || content.includes('\0')) throw Error('Base file integrity or UTF-8 text validation failed.');
        this.blobs.set(entry.oid, content);
      }
    }
  }
  list(path = '.') {
    if (path !== '.') scratchPath.parse(path);
    const prefix = path === '.' ? '' : path + '/', directory = path === '.' ? this.state.base && { type: 'tree', oid: this.state.base.tree } : this.baseEntry(path);
    if (directory && directory.type !== 'tree') throw Error('Path is not a directory.');
    if (directory && !this.state.base!.trees[directory.oid]) throw Error('Directory metadata is not loaded. Use list_files.');
    const entries = new Map<string, { path: string; mode: string; type: string; bytes?: number; oid?: string }>();
    for (const entry of directory ? this.state.base!.trees[directory.oid] ?? [] : []) if (!this.state.deleted?.includes(prefix + entry.name)) entries.set(entry.name, { path: prefix + entry.name, mode: entry.mode, type: entry.type, bytes: entry.size, oid: entry.oid });
    for (const file of this.state.files.filter(f => f.path.startsWith(prefix))) { const name = file.path.slice(prefix.length).split('/')[0]; entries.set(name, file.path === prefix + name ? { path: file.path, mode: file.mode, type: 'blob', bytes: encoder.encode(file.content).length, oid: gitObject('blob', file.content) } : { path: prefix + name, mode: '40000', type: 'tree' }); }
    if (path !== '.' && !directory && !entries.size) throw Error('Directory not found.');
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  private versionFile(path: string, state: Pick<ScratchState, 'files' | 'deleted'>) {
    if (state.deleted?.includes(path)) return;
    const local = state.files.find(f => f.path === path); if (local) return local;
    const entry = this.baseEntry(path); if (!entry) return;
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw Error('Only regular UTF-8 text files can be read or edited.');
    const content = this.blobs.get(entry.oid); if (content === undefined) throw Error('File contents are not loaded. Use read_file first.');
    return { path, mode: entry.mode as ScratchFile['mode'], content };
  }
  read(path: string) { scratchPath.parse(path); const file = this.versionFile(path, this.state); if (!file) throw Error('Scratch file not found.'); return { ...file, revision: this.revision }; }
  write(path: string, content: string, expectedRevision: number) {
    this.check(expectedRevision); scratchPath.parse(path);
    const entry = this.baseEntry(path);
    if (entry && !['100644', '100755'].includes(entry.mode)) throw Error('Only regular text files can be replaced.');
    const parts = path.split('/'); while (parts.length > 1) { parts.pop(); const parent = parts.join('/'), base = this.baseEntry(parent); if (this.state.files.some(f => f.path === parent) || base && base.type !== 'tree') throw Error('Scratch file/directory collision.'); }
    if (this.state.files.some(f => f.path.startsWith(path + '/'))) throw Error('Scratch file/directory collision.');
    const next = this.state.files.filter(f => f.path !== path); next.push({ path, content, mode: this.state.files.find(f => f.path === path)?.mode ?? entry?.mode as ScratchFile['mode'] ?? '100644' });
    validateFiles(next); this.state.files = next.sort((a, b) => a.path.localeCompare(b.path)); this.state.revision++;
    if (this.state.deleted) this.state.deleted = this.state.deleted.filter(p => p !== path);
    return { revision: this.revision };
  }
  remove(path: string, expectedRevision: number) { this.check(expectedRevision); scratchPath.parse(path); const entry = this.baseEntry(path); if (this.state.deleted?.includes(path) || !this.state.files.some(f => f.path === path) && !entry) throw Error('Scratch file not found.'); if (entry && !['100644', '100755'].includes(entry.mode)) throw Error('Only regular files can be deleted.'); this.state.files = this.state.files.filter(f => f.path !== path); if (entry) this.state.deleted = [...new Set([...(this.state.deleted ?? []), path])]; this.state.revision++; return { revision: this.revision }; }
  patch(path: string, patch: string, expectedRevision: number) { const original = this.read(path); const next = applyPatch(original.content, patch); if (next === false) throw Error('Patch does not apply.'); return this.write(path, next, expectedRevision); }
  changed() {
    const head = this.state.commits.at(-1) ?? { files: [], deleted: [] }, paths = [...new Set([...head.files, ...this.state.files].map(f => f.path).concat(head.deleted ?? [], this.state.deleted ?? []))].sort();
    const identity = (path: string, version: Pick<ScratchState, 'files' | 'deleted'>) => { if (version.deleted?.includes(path)) return null; const file = version.files.find(f => f.path === path), base = file ? undefined : this.baseEntry(path); return file ? `${file.mode}:${gitObject('blob', file.content)}` : base ? `${base.mode}:${base.oid}` : null; };
    return paths.flatMap(path => { const before = identity(path, head), after = identity(path, this.state); return before === after ? [] : [{ path, status: !before ? 'added' : !after ? 'deleted' : 'modified' }]; });
  }
  diff() {
    const head = this.state.commits.at(-1) ?? { files: [], deleted: [] };
    return this.changed().map(({ path }) => { let a: ScratchFile | undefined, b: ScratchFile | undefined; try { a = this.versionFile(path, head); b = this.versionFile(path, this.state); } catch { return { path, before: null, after: null, patch: 'Before-image not loaded. Request git_diff to fetch it.' }; } return { path, before: a?.mode ?? null, after: b?.mode ?? null, patch: createTwoFilesPatch(a ? `a/${path}` : '/dev/null', b ? `b/${path}` : '/dev/null', a?.content ?? '', b?.content ?? '', undefined, undefined, { timeout: 25, maxEditLength: 2000 }) ?? `Diff exceeds display budget: ${path}. Read the file directly.` }; });
  }
  async inspectDiff(path?: string) {
    const changed = this.changed().filter(f => !path || f.path === path || f.path.startsWith(path + '/'));
    const head: Pick<ScratchState, 'files' | 'deleted'> = this.state.commits.at(-1) ?? { files: [], deleted: [] };
    const skipped: { path: string; reason: string }[] = [];
    for (const file of changed) try { if ([head, this.state].some(version => !version.files.some(f => f.path === file.path) && !version.deleted?.includes(file.path) && this.baseEntry(file.path))) await this.prepare(file.path, 'base'); } catch (error) { skipped.push({ path: file.path, reason: error instanceof Error ? error.message : 'Before-image unavailable.' }); }
    return { changes: this.diff().filter(f => changed.some(c => c.path === f.path)), skipped, complete: skipped.length === 0 };
  }
  commit(message: string, expectedRevision: number, expectedHead: string | null, now = Date.now()) {
    this.check(expectedRevision); if (this.head !== expectedHead) throw Error('Scratch HEAD changed.');
    z.string().trim().min(1).max(4000).parse(message);
    if (this.head && !this.changed().length) throw Error('No scratch changes to commit.');
    const tree = overlayTree(this.state), parent = this.head, identity = `Browser Pi <scratch@localhost> ${Math.floor(now / 1000)} +0000`;
    const body = `tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author ${identity}\ncommitter ${identity}\n\n${message.trim()}\n`;
    const commit = { oid: gitObject('commit', body), tree, parent, body, files: structuredClone(this.state.files), ...(this.state.deleted ? { deleted: [...this.state.deleted] } : {}) };
    const next = { ...this.state, revision: this.revision + 1, commits: [...this.state.commits, commit] };
    new Scratch(next); this.state = next;
    return { oid: commit.oid, tree, parent, revision: this.revision };
  }
  applyOverlay(overlay: Scratch, expectedRevision: number) { this.check(expectedRevision); const next = overlay.snapshot(); if (next.revision < this.revision || JSON.stringify(next.commits) !== JSON.stringify(this.state.commits) || JSON.stringify(next.origin) !== JSON.stringify(this.state.origin) || next.base?.tree !== this.state.base?.tree) throw Error('Script cannot change commit history or import provenance.'); new Scratch(next); this.state = next; this.blobs = new Map([...this.blobs, ...overlay.blobs]); }
  private check(revision: number) { if (revision !== this.revision) throw Error('Scratch tree changed; read its current revision first.'); }
}

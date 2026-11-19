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
export const scratchSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  origin: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), commit: oid, directory: z.string().max(512) }).strict().nullable(),
  files, commits: z.array(z.object({ oid, tree: oid, parent: oid.nullable(), body: z.string().max(32 * 1024), files }).strict()).max(30),
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
  constructor(state: ScratchState = { version: 1, revision: 0, origin: null, files: [], commits: [] }) {
    this.state = structuredClone(scratchSchema.parse(state)); validateFiles(this.state.files);
    let parent: string | null = null;
    for (const commit of this.state.commits) {
      validateFiles(commit.files);
      if (commit.parent !== parent || scratchTree(commit.files) !== commit.tree || gitObject('commit', commit.body) !== commit.oid || !commit.body.startsWith(`tree ${commit.tree}\n${parent ? `parent ${parent}\n` : ''}author Browser Pi <scratch@localhost> `)) throw Error('Invalid scratch commit history.');
      parent = commit.oid;
    }
    if (encoder.encode(JSON.stringify(this.state)).length > 2 * 1024 * 1024) throw Error('Scratch history exceeds 2 MiB.');
  }
  snapshot() { return structuredClone(this.state); }
  get revision() { return this.state.revision; }
  get head() { return this.state.commits.at(-1)?.oid ?? null; }
  list() { return this.state.files.map(({ path, mode, content }) => ({ path, mode, bytes: encoder.encode(content).length })); }
  read(path: string) { scratchPath.parse(path); const file = this.state.files.find(f => f.path === path); if (!file) throw Error('Scratch file not found.'); return { ...file, revision: this.revision }; }
  write(path: string, content: string, expectedRevision: number) {
    this.check(expectedRevision); scratchPath.parse(path);
    const next = this.state.files.filter(f => f.path !== path); next.push({ path, content, mode: this.state.files.find(f => f.path === path)?.mode ?? '100644' });
    validateFiles(next); this.state.files = next.sort((a, b) => a.path.localeCompare(b.path)); this.state.revision++;
    return { revision: this.revision };
  }
  remove(path: string, expectedRevision: number) { this.check(expectedRevision); this.read(path); this.state.files = this.state.files.filter(f => f.path !== path); this.state.revision++; return { revision: this.revision }; }
  patch(path: string, patch: string, expectedRevision: number) { const original = this.read(path); const next = applyPatch(original.content, patch); if (next === false) throw Error('Patch does not apply.'); return this.write(path, next, expectedRevision); }
  diff() {
    const base = this.state.commits.at(-1)?.files ?? [], paths = [...new Set([...base, ...this.state.files].map(f => f.path))].sort();
    return paths.flatMap(path => { const a = base.find(f => f.path === path), b = this.state.files.find(f => f.path === path); return a?.content === b?.content && a?.mode === b?.mode ? [] : [{ path, before: a?.mode ?? null, after: b?.mode ?? null, patch: createTwoFilesPatch(a ? `a/${path}` : '/dev/null', b ? `b/${path}` : '/dev/null', a?.content ?? '', b?.content ?? '', undefined, undefined, { timeout: 25, maxEditLength: 2000 }) ?? `Diff exceeds display budget: ${path}. Read the file directly.` }]; });
  }
  commit(message: string, expectedRevision: number, expectedHead: string | null, now = Date.now()) {
    this.check(expectedRevision); if (this.head !== expectedHead) throw Error('Scratch HEAD changed.');
    z.string().trim().min(1).max(4000).parse(message);
    if (this.head && !this.diff().length) throw Error('No scratch changes to commit.');
    const tree = scratchTree(this.state.files), parent = this.head, identity = `Browser Pi <scratch@localhost> ${Math.floor(now / 1000)} +0000`;
    const body = `tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author ${identity}\ncommitter ${identity}\n\n${message.trim()}\n`;
    const commit = { oid: gitObject('commit', body), tree, parent, body, files: structuredClone(this.state.files) };
    const next = { ...this.state, revision: this.revision + 1, commits: [...this.state.commits, commit] };
    new Scratch(next); this.state = next;
    return { oid: commit.oid, tree, parent, revision: this.revision };
  }
  applyOverlay(overlay: Scratch, expectedRevision: number) { this.check(expectedRevision); const next = overlay.snapshot(); if (next.revision < this.revision || JSON.stringify(next.commits) !== JSON.stringify(this.state.commits) || JSON.stringify(next.origin) !== JSON.stringify(this.state.origin)) throw Error('Script cannot change commit history or import provenance.'); new Scratch(next); this.state = next; }
  private check(revision: number) { if (revision !== this.revision) throw Error('Scratch tree changed; read its current revision first.'); }
}

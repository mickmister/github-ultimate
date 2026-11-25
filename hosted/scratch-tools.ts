import type { CodemodeTool } from '@earendil-works/pi-codemode/portable';
import { z } from 'zod';
import { Scratch, scratchPath } from '../src/scratch';

const directory = z.union([z.literal('.'), scratchPath]).default('.');
function glob(pattern: string) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { i++; if (pattern[i + 1] === '/') { i++; regex += '(?:.*/)?'; } else regex += '.*'; }
    else regex += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$');
}
async function discover(scratch: Scratch, path: string, signal: AbortSignal) {
  const pending = [path], files: ReturnType<Scratch['list']> = []; let directories = 0;
  while (pending.length && directories < 50 && files.length < 5000) {
    signal.throwIfAborted(); const next = pending.shift()!;
    await scratch.prepare(next, false, true); directories++;
    for (const entry of scratch.list(next)) if (entry.type === 'tree') pending.push(entry.path); else files.push(entry);
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), complete: pending.length === 0, remainingDirectories: pending, directories };
}
export function scratchTools(scratch: Scratch): CodemodeTool[] {
  const revision = z.number().int().nonnegative();
  function tool<S extends z.ZodType>(name: string, description: string, schema: S, execute: (args: z.output<S>, signal: AbortSignal) => unknown): CodemodeTool {
    return { name, description, inputSchema: z.toJSONSchema(schema), execute: (args, { signal }) => { signal.throwIfAborted(); return execute(schema.parse(args), signal); } };
  }
  return [
    tool('list_files', 'List immediate files/directories and sizes. No file contents are fetched.', z.object({ path: directory }).strict(), async args => { await scratch.prepare(args.path, false, true); return { entries: scratch.list(args.path), revision: scratch.revision }; }),
    tool('find_files', 'Find paths by glob (*, **, ?) relative to the workspace root. Metadata only; at most 50 directories per call. Continue with after=nextAfter; narrow scope to remainingDirectories when traversal is incomplete.', z.object({ path: directory, glob: z.string().min(1).max(256), after: z.string().max(512).optional(), limit: z.number().int().min(1).max(200).default(100) }).strict(), async (args, signal) => { const found = await discover(scratch, args.path, signal), matcher = glob(args.glob), matches = found.files.filter(f => matcher.test(f.path) && (!args.after || f.path.localeCompare(args.after) > 0)), files = matches.slice(0, args.limit); return { files, complete: found.complete && files.length === matches.length, ...(files.length < matches.length ? { nextAfter: files.at(-1)!.path } : {}), remainingDirectories: found.remainingDirectories }; }),
    tool('read_file', 'Read current UTF-8 text, up to 128 KiB per file. content is an unnumbered line excerpt starting at startLine; nextLine indicates more text. Fetches this file on demand. Read applicable AGENTS.md instructions before editing.', z.object({ path: scratchPath, startLine: z.number().int().min(1).default(1), lineCount: z.number().int().min(1).max(500).default(200) }).strict(), async args => { await scratch.prepare(args.path, true); const value = scratch.read(args.path), lines = value.content.split('\n'); return { ...value, content: lines.slice(args.startLine - 1, args.startLine - 1 + args.lineCount).join('\n'), startLine: args.startLine, nextLine: args.startLine - 1 + args.lineCount < lines.length ? args.startLine + args.lineCount : null }; }),
    tool('write_file', 'Create/replace UTF-8 text at the expected working revision.', z.object({ path: scratchPath, content: z.string().max(128 * 1024), expectedRevision: revision }).strict(), async args => { await scratch.prepare(args.path); return scratch.write(args.path, args.content, args.expectedRevision); }),
    tool('delete_file', 'Delete one regular file without downloading its contents.', z.object({ path: scratchPath, expectedRevision: revision }).strict(), async args => { await scratch.prepare(args.path); return scratch.remove(args.path, args.expectedRevision); }),
    tool('apply_patch', 'Apply one unified patch to current text; reject stale revisions and mismatches.', z.object({ path: scratchPath, patch: z.string().max(256 * 1024), expectedRevision: revision }).strict(), async args => { await scratch.prepare(args.path, true); return scratch.patch(args.path, args.patch, args.expectedRevision); }),
    tool('search', 'Search literal text in current files under a path/glob, fetching contents as needed. Bounded to 64 files, 512 KiB and 100 matches. complete=false is not an exhaustive negative result. Continue with after=nextAfter or remainingDirectories.', z.object({ text: z.string().min(1).max(200), path: directory, glob: z.string().max(256).default('**'), after: z.string().max(512).optional() }).strict(), async (args, signal) => {
      const found = await discover(scratch, args.path, signal), matcher = glob(args.glob);
      const candidates = found.files.filter(f => matcher.test(f.path) && (!args.after || f.path.localeCompare(args.after) > 0));
      const matches: { path: string; line: number; text: string }[] = [], skipped: { path: string; reason: string }[] = [];
      let scannedFiles = 0, bytes = 0, processed = 0, nextAfter = args.after;
      for (const entry of candidates) {
        signal.throwIfAborted();
        if (processed >= 128) break;
        if (!['100644', '100755'].includes(entry.mode) || (entry.bytes ?? Infinity) > 128 * 1024) { processed++; nextAfter = entry.path; skipped.push({ path: entry.path, reason: 'Unsupported type or exceeds 128 KiB.' }); continue; }
        if (processed >= 128 || scannedFiles >= 64 || bytes + (entry.bytes ?? 0) > 512 * 1024 || matches.length >= 100) break;
        processed++; nextAfter = entry.path;
        try {
          await scratch.prepare(entry.path, true); const content = scratch.read(entry.path).content; scannedFiles++; bytes += new TextEncoder().encode(content).length;
          const lines = content.split('\n'); for (let i = 0; i < lines.length && matches.length < 100; i++) if (lines[i].includes(args.text)) matches.push({ path: entry.path, line: i + 1, text: lines[i].slice(0, 500) });
        } catch (error) { skipped.push({ path: entry.path, reason: error instanceof Error ? error.message : 'File could not be read.' }); }
      }
      return { matches, scannedFiles, bytes, skipped, complete: found.complete && processed === candidates.length && skipped.length === 0 && matches.length < 100, ...(processed < candidates.length ? { nextAfter } : {}), remainingDirectories: found.remainingDirectories };
    }),
    tool('git_status', 'Read scratch HEAD, working revision and changed paths without fetching contents.', z.object({}).strict(), () => ({ head: scratch.head, revision: scratch.revision, changed: scratch.changed() })),
    tool('git_diff', 'Read changes relative to scratch HEAD. Fetch missing before-images only for changed files. Reports incomplete/skipped diffs and bounded patch output.', z.object({ path: scratchPath.optional() }).strict(), async args => { const diff = await scratch.inspectDiff(args.path); let remaining = 32000; const changes = diff.changes.map(f => { const patch = f.patch.slice(0, Math.max(0, remaining)); remaining -= patch.length; return { ...f, patch, truncated: patch.length !== f.patch.length }; }); return { ...diff, changes, complete: diff.complete && !changes.some(f => f.truncated) }; }),
    tool('git_log', 'Read scratch commit history, newest first.', z.object({ limit: z.number().int().min(1).max(30).default(10) }).strict(), args => scratch.snapshot().commits.map(({ oid, parent, body }) => ({ oid, parent, message: body.split('\n\n').slice(1).join('\n\n') })).reverse().slice(0, args.limit)),
  ];
}

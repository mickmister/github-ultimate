import type { CodemodeTool } from '@earendil-works/pi-codemode/portable';
import { z } from 'zod';
import { Scratch, scratchPath } from '../src/scratch';

export function scratchTools(scratch: Scratch): CodemodeTool[] {
  const revision = z.number().int().nonnegative();
  function tool<S extends z.ZodType>(name: string, description: string, schema: S, execute: (args: z.output<S>) => unknown): CodemodeTool {
    return { name, description, inputSchema: z.toJSONSchema(schema), execute: (args, { signal }) => { signal.throwIfAborted(); return execute(schema.parse(args)); } };
  }
  return [
    tool('list_files', 'List scratch files with byte sizes.', z.object({}).strict(), () => scratch.list()),
    tool('read_file', 'Read a UTF-8 scratch file and current tree revision.', z.object({ path: scratchPath }).strict(), args => scratch.read(args.path)),
    tool('write_file', 'Create or replace a scratch file using the current tree revision.', z.object({ path: scratchPath, content: z.string().max(128 * 1024), expectedRevision: revision }).strict(), args => scratch.write(args.path, args.content, args.expectedRevision)),
    tool('delete_file', 'Delete a scratch file using the current tree revision.', z.object({ path: scratchPath, expectedRevision: revision }).strict(), args => scratch.remove(args.path, args.expectedRevision)),
    tool('apply_patch', 'Apply one unified patch to a named scratch file.', z.object({ path: scratchPath, patch: z.string().max(256 * 1024), expectedRevision: revision }).strict(), args => scratch.patch(args.path, args.patch, args.expectedRevision)),
    tool('search', 'Find literal text in scratch files; at most 100 matching lines.', z.object({ text: z.string().min(1).max(200) }).strict(), args => scratch.snapshot().files.flatMap(f => f.content.split('\n').flatMap((line, index) => line.includes(args.text) ? [{ path: f.path, line: index + 1, text: line.slice(0, 500) }] : [])).slice(0, 100)),
    tool('git_status', 'Read scratch HEAD, tree revision and changed paths.', z.object({}).strict(), () => ({ head: scratch.head, revision: scratch.revision, changed: scratch.diff().map(f => f.path) })),
    tool('git_diff', 'Read scratch changes relative to HEAD.', z.object({}).strict(), () => scratch.diff()),
    tool('git_log', 'Read scratch commit history, newest first.', z.object({}).strict(), () => scratch.snapshot().commits.map(({ oid, parent, body }) => ({ oid, parent, message: body.split('\n\n').slice(1).join('\n\n') })).reverse()),
  ];
}

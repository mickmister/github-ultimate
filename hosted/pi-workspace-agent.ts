import { obj, str, int, nullable } from '@earendil-works/pi-schema';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { z } from 'zod';
import type { Scratch } from '../src/scratch';
import { scratchTools } from './scratch-tools';
import { executeScratch } from './scratch-execution';

export function workspaceAgentTools(scratch: Scratch): AgentTool[] {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: undefined });
  return [
    { name: 'codemode', label: 'Run scratch JavaScript', description: 'Execute JavaScript in QuickJS. Call text(value) for output. Only these scratch tools exist: ' + JSON.stringify(scratchTools(scratch).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))) + '. Tools are async: await tools.read_file({path}). Writes need expectedRevision from git_status/read_file. No fetch, shell, imports or DOM. Successful executions apply edits together; failed executions discard them.', parameters: obj({ code: str({ maxLength: 32 * 1024 }) }), replay: 'never',
      execute: async (_id, args, signal) => result(await executeScratch(scratch, z.object({ code: z.string().max(32 * 1024) }).strict().parse(args).code, signal)) },
    { name: 'git_commit', label: 'Commit scratch changes', description: 'Commit the entire scratch working tree after inspecting git_diff. This creates a scratch Git commit only, not a GitHub push. Use expectedRevision and expectedHead from tools.git_status({}) in codemode.', parameters: obj({ message: str({ minLength: 1, maxLength: 4000 }), expectedRevision: int({ minimum: 0 }), expectedHead: nullable(str({ pattern: '^[a-f0-9]{40}$' })) }), replay: 'never',
      execute: async (_id, input, signal) => { signal?.throwIfAborted(); const args = z.object({ message: z.string().min(1).max(4000), expectedRevision: z.number().int().nonnegative(), expectedHead: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict().parse(input); return result(scratch.commit(args.message, args.expectedRevision, args.expectedHead)); } },
  ];
}

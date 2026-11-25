import { z } from 'zod';

export const contextPath = z.string().max(512).refine(path => !/[\\\x00-\x1f\x7f]/.test(path) && (!path || path.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')), 'Use a relative path outside .git, without dot segments.');
const connectionId = z.string().uuid().optional();
export const workspaceSourcesSchema = z.object({ connectionId }).strict();
export const workspaceFilesSchema = z.object({
  operation: z.enum(['list', 'find', 'read', 'search']), source: z.string().min(1).max(600), path: contextPath.default(''),
  query: z.string().min(1).max(200).optional(), offset: z.number().int().min(0).max(10000).default(0),
  limit: z.number().int().min(1).max(100).default(50), startLine: z.number().int().min(1).max(1000000).default(1),
  lineCount: z.number().int().min(1).max(200).default(100), connectionId,
}).strict().superRefine((value, ctx) => {
  if (value.operation === 'read' && !value.path || ['find', 'search'].includes(value.operation) && !value.query) ctx.addIssue({ code: 'custom', message: 'Read requires a file path; find/search require a literal query.' });
});
export type WorkspaceFilesInput = z.infer<typeof workspaceFilesSchema>;
const outputSchema = z.record(z.string(), z.unknown());
export const workspaceContextCapabilities = [
  { name: 'workspace_sources', description: 'Discover this conversation workspace’s document snapshot, associated GitHub members and explicitly configured S3 context sources. Call first for source IDs, pinned revisions and unavailable-source errors. Never infers arbitrary repositories or S3 prefixes.', schema: workspaceSourcesSchema, outputSchema },
  { name: 'workspace_files', description: 'Read-only selected-workspace files: list a directory, find paths by literal substring, read a line window, or search text by literal substring. Use source IDs from workspace_sources. All results carry provenance. Find/search are bounded and report coverage, skipped files and nextOffset; incomplete results do not prove absence. Git commits/document snapshots stay pinned for this invocation; S3 bytes are cached after a validated read. No writes or symlink/submodule traversal.', schema: workspaceFilesSchema, outputSchema },
];

// Optional published workspace configuration, not a device-local connection ID.
// Credentials and the final prefix/read grant remain host-owned on every request.
export const workspaceContextSourcesSchema = z.object({ schema_version: z.literal(1), sources: z.array(z.object({
  id: z.string().regex(/^[\w-]{1,80}$/), kind: z.literal('s3'), endpoint: z.string().url().max(1000),
  bucket: z.string().min(1).max(63), prefix: z.string().min(1).max(900).refine(value => value.endsWith('/')),
}).strict()).max(20) }).strict().refine(value => new Set(value.sources.map(source => source.id)).size === value.sources.length, 'Context source IDs must be unique.');

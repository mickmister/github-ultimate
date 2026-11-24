import { z } from 'zod';

/** Shared MCP interface. Hosts own transport, credentials and implementation. */
export const workflowScope = { id: z.string().uuid(), installationId: z.number().int().positive(), userId: z.number().int().positive() };
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const standaloneRequestSchema = z.object({
  schemaVersion: z.literal(2), process: slug, thread: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  member: z.string().min(1).max(100), baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  task: z.string().trim().min(1).max(24000), acceptanceCriteria: z.array(z.string().min(1).max(2000)).min(1).max(30), publishCandidate: z.boolean(),
}).strict();
export const workflowStartSchema = z.object({
  ...workflowScope, workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/), request: standaloneRequestSchema,
  allowSourceEffects: z.literal(true),
}).strict();
export const workflowStatusSchema = z.object({ ...workflowScope, executionReference: z.string().uuid(), reportWorkspace: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/), connectionId: z.string().uuid().optional() }).strict().optional() }).strict();
// MCP consumers select an opaque host-issued connection reference. Browser IDs,
// GitHub actor/installation checks and Kody credential picks stay adapter-owned.
const connectionRef = z.string().min(1).max(1024);
const deliveryOutput = z.object({ executionReference: z.string(), workspace: z.string(), thread: z.string(), process: z.string(), state: z.enum(['dispatch-unknown', 'dispatched']) }).passthrough();
export const workflowTools = [
  { name: 'workflows_list', description: 'List supported on-demand workflows, authorized connection references and pinned source members of the selected conversation workspace. An explicit workspace can override discovery scope. Only a parent/orchestrator may launch workflows.', schema: z.object({ workspace: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/) }).strict().optional(), connectionId: z.string().uuid().optional() }).strict(), outputSchema: z.object({ interfaceVersion: z.literal(1), workflows: z.array(z.object({ id: z.string() }).passthrough()), connections: z.array(z.object({ connectionRef }).passthrough()) }).passthrough() },
  { name: 'workflow_start', description: 'Start bounded source work once. Supply task, acceptance criteria, selected workspace/member and exact source base. No tracker or setup/test commands. Use a stable process/thread identity: repeating it returns its existing receipt; uncertainty must be inspected, never bypassed with a new process. Source authority must already be granted by the user. Candidate publication is separate from merge/PR authority. The workflow repository must be configured for this workspace.', schema: workflowStartSchema.omit({ id: true, installationId: true, userId: true }).extend({ connectionRef }).strict(), outputSchema: deliveryOutput },
  { name: 'workflow_status', description: 'Inspect the exact retained execution reference; never dispatch. Actions success is transport status, not candidate acceptance. Retrieve the bound report through workspace documents for candidate/test/approval facts.', schema: workflowStatusSchema.omit({ id: true, installationId: true, userId: true }).extend({ connectionRef }).strict(), outputSchema: deliveryOutput.extend({ executionState: z.string() }).passthrough() },
] as const;
export const workflowHostedSchemas = [
  z.object({ operation: z.literal('workflowCatalog'), workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/).optional() }).strict(),
  workflowStartSchema.extend({ operation: z.literal('workflowStart') }).strict(),
  workflowStatusSchema.extend({ operation: z.literal('workflowStatus') }).strict(),
] as const;
export const workflowOperations = workflowHostedSchemas.map(schema => schema.shape.operation.value);
export const developmentHost = { repository: 'mickmister/gh-agentic-workflows', workflow: 'development-process.yml', ref: 'vk/46e5-vd-multi-instanc' } as const;
export const workflowReportSchema = z.object({
  schemaVersion: z.literal(1), workspace: z.string(), thread: z.string(), process: z.string(), executionId: z.string().regex(/^\d+-\d+$/),
  status: z.enum(['accepted', 'exhausted', 'uncertain']), currentStep: z.string().max(200), nextStep: z.string().max(200), cycle: z.number().int().min(1).max(4),
  candidate: z.string().regex(/^[a-f0-9]{40}$/), testsPassed: z.boolean(), evaluations: z.array(z.object({ role: z.enum(['reviewer-1', 'reviewer-2', 'tester']), candidate: z.string().regex(/^[a-f0-9]{40}$/), approval: z.enum(['approve', 'reject']) }).strict()).length(3),
}).strict().superRefine((report, ctx) => {
  if (new Set(report.evaluations.map(e => e.role)).size !== 3 || report.evaluations.some(e => e.candidate !== report.candidate) || report.status === 'accepted' && (!report.testsPassed || report.evaluations.some(e => e.approval !== 'approve'))) ctx.addIssue({ code: 'custom', message: 'Candidate acceptance lacks bound checks and three explicit approvals.' });
});
export type WorkflowDelivery = {
  executionReference: string; digest: string; workspace: string; thread: string; process: string; engineCommit: string;
  userId: number; installationId: number; attemptedAt: string; state: 'dispatch-unknown' | 'dispatched'; runId?: number;
};
export function workflowRunName(delivery: Pick<WorkflowDelivery, 'workspace' | 'thread' | 'process'>) {
  return `Development ${delivery.workspace} / ${delivery.thread} / ${delivery.process} · run`;
}

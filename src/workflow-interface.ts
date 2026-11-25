import { z } from 'zod';
import { actionJobSchema } from './actions-protocol';
import { commitCiSchema } from './commit-ci';

/** Shared MCP interface. Hosts own transport, credentials and implementation. */
export const workflowScope = { id: z.string().uuid(), installationId: z.number().int().positive(), userId: z.number().int().positive() };
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const workflowDeliverySchema = z.object({
  executionReference: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), workspace: z.string().min(1).max(160), thread: z.string().min(1).max(80), process: slug,
  engineCommit: z.string().regex(/^[a-f0-9]{40}$/), userId: z.number().int().positive(), installationId: z.number().int().positive(), attemptedAt: z.string().datetime(),
  state: z.enum(['dispatch-unknown', 'dispatched']), runId: z.number().int().positive().optional(), connectionId: z.string().uuid().optional(),
}).strict();
export const standaloneRequestSchema = z.object({
  schemaVersion: z.literal(2), process: slug, thread: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  member: z.string().min(1).max(100),
  task: z.string().trim().min(1).max(24000), acceptanceCriteria: z.array(z.string().min(1).max(2000)).min(1).max(30), publishCandidate: z.boolean().default(false), delivery: z.enum(['auto', 'pull-request']).optional(),
}).strict();
export const workflowStartSchema = z.object({
  ...workflowScope, workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/), request: standaloneRequestSchema,
  allowSourceEffects: z.literal(true),
}).strict();
export const workflowStatusSchema = z.object({ ...workflowScope, executionReference: z.string().uuid(), recoveryReceipt: workflowDeliverySchema.optional(), reportWorkspace: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/), connectionId: z.string().uuid().optional() }).strict().optional() }).strict();
// MCP consumers select an opaque host-issued connection reference. Browser IDs,
// GitHub actor/installation checks and Kody credential picks stay adapter-owned.
const connectionRef = z.string().min(1).max(1024);
const deliveryOutput = z.object({ executionReference: z.string(), workspace: z.string(), thread: z.string(), process: z.string(), state: z.enum(['dispatch-unknown', 'dispatched']) }).passthrough();
export const workflowTools = [
  { name: 'workflows_list', description: 'List supported on-demand workflows, authorized connection references and source branch members of the selected conversation workspace. An explicit workspace can override discovery scope. Only a parent/orchestrator may launch workflows.', schema: z.object({ workspace: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/) }).strict().optional(), connectionId: z.string().uuid().optional() }).strict(), outputSchema: z.object({ interfaceVersion: z.literal(1), workflows: z.array(z.object({ id: z.string() }).passthrough()), connections: z.array(z.object({ connectionRef }).passthrough()) }).passthrough() },
  { name: 'workflow_start', description: 'Start bounded source work once. Supply task, acceptance criteria and selected workspace/member. Resolve configured branch heads at startup. After exact candidate approvals/checks, deliver non-force branch commits or a PR and a CI-authored review; deeper analysis follows separately. No caller commit, tracker or setup/test commands. Use a stable process/thread identity: repeating it returns its existing receipt; uncertainty must be inspected, never bypassed with a new process. Source delivery authority must already be granted by the user. The workflow repository must be configured for this workspace.', schema: workflowStartSchema.omit({ id: true, installationId: true, userId: true }).extend({ connectionRef }).strict(), outputSchema: deliveryOutput },
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]), workspace: z.string(), thread: z.string(), process: z.string(), executionId: z.string().regex(/^\d+-\d+$/),
  status: z.enum(['accepted', 'exhausted', 'uncertain']), currentStep: z.string().max(200), nextStep: z.string().max(200), cycle: z.number().int().min(0).max(4),
  candidate: z.string().regex(/^[a-f0-9]{40}$/).optional(), testsPassed: z.boolean(), evaluations: z.array(z.object({ role: z.enum(['reviewer-1', 'reviewer-2', 'tester']), candidate: z.string().regex(/^[a-f0-9]{40}$/), approval: z.enum(['approve', 'reject']) }).strict()).max(3),
  environmentCache: z.object({ status: z.string() }).passthrough().optional(),
  delivery: z.discriminatedUnion('status', [
    z.object({ status: z.literal('delivered'), kind: z.enum(['branch', 'pull-request']), repository: z.string(), branch: z.string(), candidate: z.string().regex(/^[a-f0-9]{40}$/), baseCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(), commits: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(1000).optional(), commitsPartial: z.boolean().optional(), url: z.string().url(), receipts: z.array(z.string()).max(3) }).strict(),
    z.object({ status: z.literal('blocked'), reason: z.string(), candidate: z.string().optional(), receipts: z.array(z.string()).max(3) }).strict(),
  ]).optional(), analysis: z.enum(['pending', 'running', 'complete', 'failed']).optional(), reviewRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/).optional(),
}).strict().superRefine((report, ctx) => {
  if ((report.schemaVersion === 1 || report.status === 'accepted') && (!report.candidate || report.cycle < 1 || new Set(report.evaluations.map(e => e.role)).size !== 3) || report.evaluations.some(e => e.candidate !== report.candidate) || report.status === 'accepted' && (!report.testsPassed || report.evaluations.some(e => e.approval !== 'approve'))) ctx.addIssue({ code: 'custom', message: 'Candidate acceptance lacks bound checks and three explicit approvals.' });
  if (report.schemaVersion === 2 && (!report.delivery || !report.analysis || !report.reviewRequestId || report.delivery.status === 'delivered' && (report.status !== 'accepted' || report.delivery.candidate !== report.candidate))) ctx.addIssue({ code: 'custom', message: 'Delivery requires a bound accepted candidate and review/analysis state.' });
  if (report.delivery?.status === 'delivered' && (report.delivery.baseCommit === report.delivery.candidate || report.delivery.commits && (!report.delivery.commits.includes(report.delivery.candidate) || new Set(report.delivery.commits).size !== report.delivery.commits.length))) ctx.addIssue({ code: 'custom', message: 'Delivered source range must include its unique candidate commits.' });
});
export const workflowProgressSchema = z.object({ schemaVersion: z.literal(1), workspace: z.string(), thread: z.string(), process: z.string(), executionId: z.string().regex(/^\d+-\d+$/),
  updatedAt: z.string().datetime(), currentStep: z.string().max(200), nextStep: z.string().max(200), cycle: z.number().int().min(0).max(4), maxCycles: z.literal(4),
  roles: z.array(z.object({ role: z.enum(['implementer', 'reviewer-1', 'reviewer-2', 'tester']), status: z.enum(['running', 'completed']) }).strict()).max(4),
  delivery: z.enum(['pending', 'delivered', 'blocked', 'uncertain']), analysis: z.enum(['pending', 'running', 'complete', 'failed']), reviewUrl: z.string().url().optional(),
}).strict();
export const workflowObservationSchema = workflowDeliverySchema.extend({ executionState: z.string().optional(), conclusion: z.string().nullable().optional(), attempt: z.number().int().positive().optional(),
  runUrl: z.string().url().optional(), createdAt: z.string().datetime().optional(), startedAt: z.string().datetime().nullable().optional(), jobs: z.array(actionJobSchema).max(100).optional(), jobsPartial: z.boolean().optional(),
  progress: workflowProgressSchema.optional(), progressState: z.string().optional(), candidateAcceptance: z.string().optional(), result: workflowReportSchema.optional(),
  sourceCi: commitCiSchema.optional(), sourceCiError: z.string().optional(),
  review: z.object({ url: z.string().url(), version: z.string(), snapshot: z.string() }).optional(), report: z.object({ name: z.string(), version: z.string(), snapshot: z.string(), url: z.string().url() }).optional(),
}).strip();
export type WorkflowObservation = z.infer<typeof workflowObservationSchema>;
export type WorkflowDelivery = z.infer<typeof workflowDeliverySchema>;
export function workflowRunName(delivery: Pick<WorkflowDelivery, 'workspace' | 'thread' | 'process'>) {
  return `Development ${delivery.workspace} / ${delivery.thread} / ${delivery.process} · run`;
}

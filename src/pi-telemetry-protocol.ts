import { z } from 'zod';

export const maxPiTelemetryBytes = 128 * 1024;
export const maxPiTelemetrySpans = 256;
const traceId = z.string().regex(/^[a-f0-9]{32}$/);
const spanId = z.string().regex(/^[a-f0-9]{16}$/);
const attributes = z.array(z.object({
  key: z.enum(['service.name', 'service.version', 'pi.conversation.id', 'pi.branch.id', 'gen_ai.tool.name', 'pi.tool.call_id', 'pi.capability.name', 'pi.outcome', 'pi.dropped_spans']),
  value: z.union([z.object({ stringValue: z.string().max(128) }).strict(), z.object({ intValue: z.string().regex(/^\d{1,10}$/) }).strict()]),
}).strict()).max(8);
const span = z.object({
  traceId, spanId, parentSpanId: spanId.optional(),
  name: z.enum(['pi.agent.invocation', 'pi.agent.tool', 'pi.agent.capability']), kind: z.literal(1),
  startTimeUnixNano: z.string().regex(/^\d{1,20}$/), endTimeUnixNano: z.string().regex(/^\d{1,20}$/),
  attributes, status: z.object({ code: z.union([z.literal(1), z.literal(2)]) }).strict(),
}).strict();
/** OTLP/JSON ExportTraceServiceRequest, deliberately restricted to performance metadata. */
export const piTelemetrySchema = z.object({ resourceSpans: z.array(z.object({
  resource: z.object({ attributes }).strict(),
  scopeSpans: z.array(z.object({ scope: z.object({ name: z.literal('pi-agent-performance'), version: z.literal('1') }).strict(), spans: z.array(span).min(1).max(maxPiTelemetrySpans + 1) }).strict()).length(1),
}).strict()).length(1) }).strict();
export type PiTelemetryData = z.infer<typeof piTelemetrySchema>;

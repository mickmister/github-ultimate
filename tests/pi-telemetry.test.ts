import { expect, test } from 'vitest';
import { PiTelemetry } from '../hosted/pi-telemetry';
import { maxPiTelemetryBytes, maxPiTelemetrySpans, piTelemetrySchema } from '../src/pi-telemetry-protocol';

test('OTLP trace correlates nested parallel capabilities, timings and sanitized outcomes', async () => {
  const session = crypto.randomUUID(), branch = crypto.randomUUID(), trace = new PiTelemetry(session, branch);
  await trace.measure('tool', 'codemode', async parent => {
    await Promise.all(['workspace_sources', 'workspace_files'].map(name => trace.measure('capability', name, async () => 'private tool output', { parent })));
  }, { callId: 'call-1' });
  await expect(trace.measure('capability', 'workflow_start', async () => { throw Error('private provider error'); })).rejects.toThrow('private provider error');
  await trace.measure('tool', 'codemode', async (_parent, failed) => { failed(); return { ok: false, error: 'private sandbox error' }; });
  const signal = AbortSignal.abort();
  await expect(trace.measure('tool', 'codemode', async () => { throw Error('cancelled secret'); }, { signal })).rejects.toThrow();
  const data = piTelemetrySchema.parse(trace.data('interrupted')), spans = data.resourceSpans[0].scopeSpans[0].spans;
  const [root, tool, first, second, failed, sandbox, cancelled] = spans;
  expect(root.attributes).toContainEqual({ key: 'pi.conversation.id', value: { stringValue: session } });
  expect(root.status.code).toBe(2); expect(tool.parentSpanId).toBe(root.spanId);
  expect(first.parentSpanId).toBe(tool.spanId); expect(second.parentSpanId).toBe(tool.spanId);
  expect(tool.attributes).toContainEqual({ key: 'pi.tool.call_id', value: { stringValue: 'call-1' } });
  expect(failed.status.code).toBe(2); expect(sandbox.status.code).toBe(2);
  expect(cancelled.attributes).toContainEqual({ key: 'pi.outcome', value: { stringValue: 'cancelled' } });
  for (const span of spans) { expect(span.traceId).toBe(trace.traceId); expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano)); }
  expect(JSON.stringify(data)).not.toMatch(/private|cancelled secret/);
});

test('trace bounds retain parents, report dropped spans and omit incomplete late capabilities', async () => {
  const trace = new PiTelemetry(crypto.randomUUID(), crypto.randomUUID());
  let finish!: () => void;
  const late = trace.measure('capability', 'workspace_files', () => new Promise<void>(resolve => { finish = resolve; }));
  for (let i = 0; i < maxPiTelemetrySpans + 20; i++) await trace.measure('tool', 'codemode', async () => {});
  const data = trace.data('interrupted'), spans = data.resourceSpans[0].scopeSpans[0].spans;
  expect(spans).toHaveLength(maxPiTelemetrySpans);
  expect(spans[0].attributes).toContainEqual({ key: 'pi.dropped_spans', value: { intValue: '22' } });
  expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(maxPiTelemetryBytes);
  expect(spans.every(span => span.endTimeUnixNano !== '0')).toBe(true);
  finish(); await late;
});

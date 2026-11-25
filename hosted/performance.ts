import { observeOperations } from './performance-hooks';
type Attributes = Record<string, string | number | boolean>;
type Span = { name: string; spanId: string; start: number; end: number; attributes: Attributes; failed: boolean };
const limit = 2000;
const listeners = new Set<() => void>();
let revision = 0;
let capture: { traceId: string; spanId: string; start: number; end?: number; spans: Span[]; dropped: number } | undefined;
const now = () => performance.timeOrigin + performance.now();
const id = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function changed() { revision++; for (const listener of listeners) listener(); }

/** Opt-in, bounded local diagnostics. Never records request bodies, URLs or errors' text. */
export async function measure<T>(name: string, operation: () => Promise<T>, attributes: Attributes = {}): Promise<T> {
  const active = capture;
  if (!active || active.end !== undefined) return operation();
  const span: Span = { name, spanId: id(8), start: now(), end: 0, attributes: { ...attributes }, failed: false };
  try { return await operation(); }
  catch (error) { span.failed = true; throw error; }
  finally {
    span.end = now();
    if (capture === active) {
      if (active.spans.length < limit) active.spans.push(span); else active.dropped++;
      changed();
    }
  }
}
const nano = (milliseconds: number) => (BigInt(Math.round(milliseconds * 1000)) * 1000n).toString();
const attributes = (values: Attributes) => Object.entries(values).map(([key, value]) => ({ key, value: typeof value === 'number' ? { doubleValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } }));
export const reviewPerf = {
  start() { capture = { traceId: id(16), spanId: id(8), start: now(), spans: [], dropped: 0 }; changed(); },
  stop() { if (capture && capture.end === undefined) { capture.end = now(); changed(); } return reviewPerf.summary(); },
  clear() { capture = undefined; changed(); },
  status() { return { running: Boolean(capture && capture.end === undefined), count: capture?.spans.length ?? 0, dropped: capture?.dropped ?? 0 }; },
  summary() {
    const groups = new Map<string, number[]>();
    for (const span of capture?.spans ?? []) groups.set(span.name, [...(groups.get(span.name) ?? []), span.end - span.start]);
    return [...groups].map(([operation, values]) => {
      const sorted = values.sort((a, b) => a - b);
      return { operation, count: values.length, totalMs: Math.round(values.reduce((a, b) => a + b, 0)), p95Ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), maxMs: Math.round(sorted.at(-1)!) };
    }).sort((a, b) => b.totalMs - a.totalMs);
  },
  export() {
    if (!capture) throw new Error('Start a performance capture first.');
    const active = capture;
    return { resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'github-ultimate-webapp', 'diagnostics.dropped_spans': active.dropped }) }, scopeSpans: [{ scope: { name: 'review-performance', version: '1' }, spans: [
      { traceId: active.traceId, spanId: active.spanId, name: 'review.capture', kind: 1, startTimeUnixNano: nano(active.start), endTimeUnixNano: nano(active.end ?? now()), attributes: [], status: { code: 1 } },
      ...active.spans.map(span => ({ traceId: active.traceId, spanId: span.spanId, parentSpanId: active.spanId, name: span.name, kind: 1, startTimeUnixNano: nano(span.start), endTimeUnixNano: nano(Math.min(span.end, active.end ?? span.end)), attributes: attributes(span.attributes), status: { code: span.failed ? 2 : 1 } })),
    ] }] }] };
  },
  download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(reviewPerf.export(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'review-performance.otel.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => revision,
};
export function installReviewPerf() { window.reviewPerf = reviewPerf; }
observeOperations(measure);
declare global { interface Window { reviewPerf: typeof reviewPerf } }

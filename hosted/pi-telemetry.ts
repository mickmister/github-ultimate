import { maxPiTelemetryBytes, maxPiTelemetrySpans, type PiTelemetryData } from '../src/pi-telemetry-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PiBridge } from './pi-transport';
declare const PI_WEB_BUILD_SHA: string;

type Span = PiTelemetryData['resourceSpans'][number]['scopeSpans'][number]['spans'][number];
const id = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const now = () => performance.timeOrigin + performance.now();
const nano = (ms: number) => (BigInt(Math.round(ms * 1000)) * BigInt(1000)).toString();
const attribute = (key: Span['attributes'][number]['key'], value: string) => ({ key, value: { stringValue: value.slice(0, 128) } });
export type PiTelemetryStatus = { state: 'uploading' | 'saved' | 'failed'; traceId: string; key?: string };

/** One bounded trace per explicit invocation; no inputs, results, URLs or error text. */
export class PiTelemetry {
  readonly traceId = id(16);
  private rootId = id(8);
  private start = now();
  private spans: Span[] = [];
  private dropped = 0;
  constructor(private sessionId: string, private branchId: string) {}
  async measure<T>(kind: 'tool' | 'capability', name: string, operation: (parent: string, failed: () => void) => Promise<T>, options: { parent?: string; callId?: string; signal?: AbortSignal } = {}): Promise<T> {
    const span: Span = { traceId: this.traceId, spanId: id(8), parentSpanId: options.parent ?? this.rootId, name: `pi.agent.${kind}`, kind: 1, startTimeUnixNano: nano(now()), endTimeUnixNano: '0', attributes: [attribute(kind === 'tool' ? 'gen_ai.tool.name' : 'pi.capability.name', name), ...(options.callId ? [attribute('pi.tool.call_id', options.callId)] : [])], status: { code: 1 } };
    // Reserve on entry, so the parent survives truncation and parallel calls stay bounded.
    if (this.spans.length < maxPiTelemetrySpans) this.spans.push(span); else this.dropped++;
    let outcome = 'success';
    const failed = () => { span.status.code = 2; outcome = options.signal?.aborted ? 'cancelled' : 'error'; };
    try { return await operation(span.spanId, failed); }
    catch (error) { failed(); if (error instanceof Error && error.name === 'AbortError') outcome = 'cancelled'; throw error; }
    finally { span.endTimeUnixNano = nano(now()); span.attributes.push(attribute('pi.outcome', outcome)); }
  }
  data(outcome: 'success' | 'interrupted' | 'error'): PiTelemetryData {
    const end = nano(now());
    const root: Span = { traceId: this.traceId, spanId: this.rootId, name: 'pi.agent.invocation', kind: 1, startTimeUnixNano: nano(this.start), endTimeUnixNano: end, attributes: [attribute('pi.conversation.id', this.sessionId), attribute('pi.branch.id', this.branchId), attribute('pi.outcome', outcome)], status: { code: outcome === 'success' ? 1 : 2 } };
    const spans = [root, ...this.spans.filter(span => span.endTimeUnixNano !== '0')];
    const data: PiTelemetryData = { resourceSpans: [{ resource: { attributes: [attribute('service.name', 'github-ultimate-pi-web'), ...(typeof PI_WEB_BUILD_SHA === 'undefined' ? [] : [attribute('service.version', PI_WEB_BUILD_SHA)])] }, scopeSpans: [{ scope: { name: 'pi-agent-performance', version: '1' }, spans }] }] };
    const dropped = { key: 'pi.dropped_spans' as const, value: { intValue: String(this.dropped + this.spans.length - spans.length + 1) } };
    root.attributes.push(dropped);
    while (new TextEncoder().encode(JSON.stringify(data)).length > maxPiTelemetryBytes && spans.length > 1) { spans.pop(); dropped.value.intValue = String(Number(dropped.value.intValue) + 1); }
    return data;
  }
  async upload(bridge: PiBridge, storage: PublicS3Connection, outcome: 'success' | 'interrupted' | 'error'): Promise<PiTelemetryStatus> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(this.data(outcome)));
      let binary = ''; for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
      const receipt = await bridge<{ key: string; size: number }>({ operation: 's3PiTelemetry', id: storage.id, revision: storage.revision, sessionId: this.sessionId, base64: btoa(binary) }, 35000);
      if (!receipt.key.startsWith(`${storage.prefix}telemetry/pi-agent/`) || receipt.size !== bytes.length) throw Error('Invalid telemetry receipt.');
      return { state: 'saved', traceId: this.traceId, key: receipt.key };
    } catch { return { state: 'failed', traceId: this.traceId }; }
  }
}

import { Gunzip } from 'fflate';
import protobuf from 'protobufjs';
import { sha256 } from '../hosted/workflow-runs';

// OTLP wire field numbers from opentelemetry-proto v1.5.0. Retain typed AnyValue,
// resource/scope attributes and complete decoded metric points as JSON columns.
const schema = `syntax = "proto3";
message AnyValue { oneof value { string stringValue=1; bool boolValue=2; int64 intValue=3; double doubleValue=4; ArrayValue arrayValue=5; KeyValueList kvlistValue=6; bytes bytesValue=7; } }
message ArrayValue { repeated AnyValue values=1; } message KeyValueList { repeated KeyValue values=1; } message KeyValue { string key=1; AnyValue value=2; }
message Resource { repeated KeyValue attributes=1; uint32 droppedAttributesCount=2; }
message Scope { string name=1; string version=2; repeated KeyValue attributes=3; uint32 droppedAttributesCount=4; }
message Status { string message=2; int32 code=3; }
message SpanEvent { fixed64 timeUnixNano=1; string name=2; repeated KeyValue attributes=3; uint32 droppedAttributesCount=4; }
message SpanLink { bytes traceId=1; bytes spanId=2; string traceState=3; repeated KeyValue attributes=4; uint32 droppedAttributesCount=5; fixed32 flags=6; }
message Span { bytes traceId=1; bytes spanId=2; string traceState=3; bytes parentSpanId=4; string name=5; int32 kind=6; fixed64 startTimeUnixNano=7; fixed64 endTimeUnixNano=8; repeated KeyValue attributes=9; uint32 droppedAttributesCount=10; repeated SpanEvent events=11; uint32 droppedEventsCount=12; repeated SpanLink links=13; uint32 droppedLinksCount=14; Status status=15; fixed32 flags=16; }
message ScopeSpans { Scope scope=1; repeated Span spans=2; string schemaUrl=3; } message ResourceSpans { Resource resource=1; repeated ScopeSpans scopeSpans=2; string schemaUrl=3; }
message Traces { repeated ResourceSpans resourceSpans=1; }
message LogRecord { fixed64 timeUnixNano=1; int32 severityNumber=2; string severityText=3; AnyValue body=5; repeated KeyValue attributes=6; uint32 droppedAttributesCount=7; fixed32 flags=8; bytes traceId=9; bytes spanId=10; fixed64 observedTimeUnixNano=11; string eventName=12; }
message ScopeLogs { Scope scope=1; repeated LogRecord logRecords=2; string schemaUrl=3; } message ResourceLogs { Resource resource=1; repeated ScopeLogs scopeLogs=2; string schemaUrl=3; } message Logs { repeated ResourceLogs resourceLogs=1; }
message Exemplar { repeated KeyValue filteredAttributes=7; fixed64 timeUnixNano=2; double asDouble=3; sfixed64 asInt=6; bytes spanId=4; bytes traceId=5; }
message NumberPoint { fixed64 startTimeUnixNano=2; fixed64 timeUnixNano=3; double asDouble=4; repeated Exemplar exemplars=5; sfixed64 asInt=6; repeated KeyValue attributes=7; uint32 flags=8; }
message HistogramPoint { fixed64 startTimeUnixNano=2; fixed64 timeUnixNano=3; fixed64 count=4; double sum=5; repeated fixed64 bucketCounts=6; repeated double explicitBounds=7; repeated Exemplar exemplars=8; repeated KeyValue attributes=9; uint32 flags=10; double min=11; double max=12; }
message Buckets { sint32 offset=1; repeated uint64 bucketCounts=2; }
message ExponentialPoint { repeated KeyValue attributes=1; fixed64 startTimeUnixNano=2; fixed64 timeUnixNano=3; fixed64 count=4; double sum=5; sint32 scale=6; fixed64 zeroCount=7; Buckets positive=8; Buckets negative=9; uint32 flags=10; repeated Exemplar exemplars=11; double min=12; double max=13; double zeroThreshold=14; }
message Quantile { double quantile=1; double value=2; } message SummaryPoint { fixed64 startTimeUnixNano=2; fixed64 timeUnixNano=3; fixed64 count=4; double sum=5; repeated Quantile quantileValues=6; repeated KeyValue attributes=7; uint32 flags=8; }
message Gauge { repeated NumberPoint dataPoints=1; } message Sum { repeated NumberPoint dataPoints=1; int32 aggregationTemporality=2; bool isMonotonic=3; } message Histogram { repeated HistogramPoint dataPoints=1; int32 aggregationTemporality=2; } message ExponentialHistogram { repeated ExponentialPoint dataPoints=1; int32 aggregationTemporality=2; } message Summary { repeated SummaryPoint dataPoints=1; }
message Metric { string name=1; string description=2; string unit=3; Gauge gauge=5; Sum sum=7; Histogram histogram=9; ExponentialHistogram exponentialHistogram=10; Summary summary=11; repeated KeyValue metadata=12; }
message ScopeMetrics { Scope scope=1; repeated Metric metrics=2; string schemaUrl=3; } message ResourceMetrics { Resource resource=1; repeated ScopeMetrics scopeMetrics=2; string schemaUrl=3; } message Metrics { repeated ResourceMetrics resourceMetrics=1; }
`;
export const otlpRoot = protobuf.parse(schema).root;
export type TelemetryRow = Record<string, string | number | null>;
export type TelemetryTables = Record<'spans' | 'span_events' | 'span_links' | 'logs' | 'metrics', TelemetryRow[]>;
export interface TelemetryDataset { tables: TelemetryTables; signals: string[]; warnings: string[] }
const maxExpanded = 32 * 1024 * 1024;
const budgets = new WeakMap<TelemetryDataset, { rows: number; bytes: number }>();
function addRow(dataset: TelemetryDataset, table: keyof TelemetryTables, row: TelemetryRow) {
  const budget = budgets.get(dataset) ?? { rows: 0, bytes: 0 };
  budget.rows++;
  budget.bytes += Object.values(row).reduce<number>((sum, value) => sum + (typeof value === 'string' ? value.length * 2 : 8), 0);
  if (budget.rows > 100000 || budget.bytes > maxExpanded) throw Error('Decoded telemetry exceeds the 100,000-row / 32 MiB table budget.');
  budgets.set(dataset, budget); dataset.tables[table].push(row);
}
export function boundedGunzip(input: Uint8Array) {
  const chunks: Uint8Array[] = []; let size = 0;
  const decoder = new Gunzip(chunk => { size += chunk.length; if (size > maxExpanded) throw Error('Decompressed telemetry exceeds 32 MiB.'); chunks.push(chunk); });
  for (let index = 0; index < input.length; index += 16384) decoder.push(input.subarray(index, index + 16384), index + 16384 >= input.length);
  const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
export function tarMembers(bytes: Uint8Array) {
  const result = new Map<string, Uint8Array<ArrayBuffer>>();
  const text = (start: number, length: number) => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length)).replace(/\0.*$/, '');
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    if (bytes.subarray(offset, offset + 512).every(byte => byte === 0)) break;
    const name = text(offset, 100), prefix = text(offset + 345, 155), path = prefix ? `${prefix}/${name}` : name;
    const sizeText = text(offset + 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw Error('Unsupported telemetry tar size.');
    const size = parseInt(sizeText, 8), kind = bytes[offset + 156];
    if (![0, 48].includes(kind) || path.split('/').some(part => !part || part === '.' || part === '..') || path.startsWith('/') || result.has(path)) throw Error('Unsafe or unsupported telemetry archive member.');
    let checksum = 0; for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : bytes[offset + i];
    if (checksum !== parseInt(text(offset + 148, 8).trim(), 8) || offset + 512 + size > bytes.length) throw Error('Invalid telemetry archive header.');
    if (result.size >= 2048) throw Error('Too many archive members.');
    result.set(path, bytes.slice(offset + 512, offset + 512 + size)); offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}
// protobufjs toObject values are deliberately dynamic; wire values never execute.
type Value = Record<string, any>;
const json = (value: unknown) => JSON.stringify(value ?? null);
const id = (value: string | undefined) => value ? [...Uint8Array.from(atob(value), char => char.charCodeAt(0))].map(byte => byte.toString(16).padStart(2, '0')).join('') : '';
const attr = (values: Value[] | undefined, name: string) => values?.find(item => item.key === name)?.value?.stringValue ?? '';
export function decodeSignal(bytes: Uint8Array, signal: 'traces' | 'logs' | 'metrics', job: string, dataset: TelemetryDataset) {
  const newline = bytes.indexOf(10), second = bytes.indexOf(10, newline + 1);
  if (newline < 0 || second < 0) throw Error('Malformed OTLP transport envelope.');
  const type = new TextDecoder().decode(bytes.subarray(0, newline)), encoding = new TextDecoder().decode(bytes.subarray(newline + 1, second));
  if (type !== 'application/x-protobuf' || !['', 'identity', 'gzip'].includes(encoding)) throw Error(`Unsupported OTLP content type/encoding: ${type}/${encoding}.`);
  const body = encoding === 'gzip' ? boundedGunzip(bytes.subarray(second + 1)) : bytes.subarray(second + 1);
  const message = otlpRoot.lookupType(signal === 'traces' ? 'Traces' : signal === 'logs' ? 'Logs' : 'Metrics');
  const decoded = message.toObject(message.decode(body), { longs: String, bytes: String }) as Value;
  if (!dataset.signals.includes(signal)) dataset.signals.push(signal);
  const resources = decoded[signal === 'traces' ? 'resourceSpans' : signal === 'logs' ? 'resourceLogs' : 'resourceMetrics'] ?? [];
  for (const resource of resources) for (const scope of resource[signal === 'traces' ? 'scopeSpans' : signal === 'logs' ? 'scopeLogs' : 'scopeMetrics'] ?? []) {
    const common = { job_instance: job, service_name: attr(resource.resource?.attributes, 'service.name'), resource_json: json(resource.resource), scope_json: json(scope.scope), resource_schema_url: resource.schemaUrl ?? '', scope_schema_url: scope.schemaUrl ?? '' };
    if (signal === 'traces') for (const span of scope.spans ?? []) {
      const trace_id = id(span.traceId), span_id = id(span.spanId);
      const start = BigInt(span.startTimeUnixNano ?? '0'), end = BigInt(span.endTimeUnixNano ?? '0');
      addRow(dataset, 'spans', { ...common, trace_id, span_id, parent_span_id: id(span.parentSpanId), name: span.name ?? '', start_time_ns: start.toString(), end_time_ns: end.toString(), duration_ms: end >= start ? Number(end - start) / 1e6 : null, status_code: span.status?.code ?? 0, attributes_json: json(span.attributes), record_json: json(span) });
      for (const event of span.events ?? []) addRow(dataset, 'span_events', { ...common, trace_id, span_id, name: event.name ?? '', time_ns: event.timeUnixNano ?? '0', attributes_json: json(event.attributes), record_json: json(event) });
      for (const link of span.links ?? []) addRow(dataset, 'span_links', { ...common, trace_id, span_id, linked_trace_id: id(link.traceId), linked_span_id: id(link.spanId), attributes_json: json(link.attributes), record_json: json(link) });
    }
    if (signal === 'logs') for (const log of scope.logRecords ?? []) addRow(dataset, 'logs', { ...common, trace_id: id(log.traceId), span_id: id(log.spanId), time_ns: log.timeUnixNano ?? '0', observed_time_ns: log.observedTimeUnixNano ?? '0', severity: log.severityText ?? '', body_json: json(log.body), attributes_json: json(log.attributes), record_json: json(log) });
    if (signal === 'metrics') for (const metric of scope.metrics ?? []) {
      const type = ['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'].find(key => metric[key]);
      if (!type) { dataset.warnings.push(`Unsupported metric data: ${metric.name ?? '(unnamed)'}`); continue; }
      for (const point of metric[type].dataPoints ?? []) addRow(dataset, 'metrics', { ...common, name: metric.name ?? '', unit: metric.unit ?? '', metric_type: type, time_ns: point.timeUnixNano ?? '0', start_time_ns: point.startTimeUnixNano ?? '0', value: point.asInt !== undefined ? String(point.asInt) : point.asDouble ?? null, temporality: metric[type].aggregationTemporality ?? null, monotonic: metric[type].isMonotonic === undefined ? null : String(metric[type].isMonotonic), point_json: json(point), descriptor_json: json({ ...metric, [type]: undefined }), attributes_json: json(point.attributes) });
    }
  }
}
export async function decodeTelemetryArchive(bytes: Uint8Array, members: { name: string; bytes: number; sha256: string }[], job: string): Promise<TelemetryDataset> {
  const files = tarMembers(boundedGunzip(bytes));
  if (members.length !== files.size || new Set(members.map(item => item.name)).size !== members.length) throw Error('Archive member inventory mismatch.');
  const dataset: TelemetryDataset = { tables: { spans: [], span_events: [], span_links: [], logs: [], metrics: [] }, signals: [], warnings: ['Only this selected job export is loaded. Missing jobs/signals are not inferred. Decoder schema: OTLP v1.5.0; unknown protobuf fields are not exposed. Raw S3 export remains authoritative.'] };
  for (const member of members) {
    const file = files.get(member.name);
    if (!file || file.length !== member.bytes || await sha256(file) !== member.sha256) throw Error('Telemetry archive member digest mismatch.');
    const signal = /^otel\/[^/]+\.(traces|logs|metrics)$/.exec(member.name)?.[1] as 'traces' | 'logs' | 'metrics' | undefined;
    if (signal) decodeSignal(file, signal, job, dataset);
  }
  return dataset;
}

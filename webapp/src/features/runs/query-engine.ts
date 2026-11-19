import * as duckdb from '@duckdb/duckdb-wasm';
import compressedWasmURL from 'virtual:duckdb-wasm-url';
import workerURL from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { Table, vectorFromArray, Float64, Utf8 } from 'apache-arrow';
import type { TelemetryDataset } from '../../../../src/otel-tables';

export interface QueryResult { columns: string[]; rows: string[][]; truncated: boolean }
export class TelemetryQueryEngine {
  private worker = new Worker(workerURL);
  private db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), this.worker);
  private connection?: duckdb.AsyncDuckDBConnection;
  private stopped = false;
  async load(dataset: TelemetryDataset) {
    const response = await fetch(compressedWasmURL, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw Error('Unable to load the local DuckDB Wasm asset.');
    const reader = response.body.pipeThrough(new DecompressionStream('gzip')).getReader(), chunks: ArrayBuffer[] = [];
    let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (this.stopped || size > 48 * 1024 * 1024) { await reader.cancel(); throw Error('Cancelled or oversized DuckDB asset.'); } chunks.push(new Uint8Array(value).buffer); } }
    finally { reader.releaseLock(); }
    const blobURL = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
    try { await this.db.instantiate(blobURL); } finally { URL.revokeObjectURL(blobURL); }
    if (this.stopped) throw Error('Query engine cancelled.');
    await this.db.open({ maximumThreads: 1, allowUnsignedExtensions: false });
    const conn = this.connection = await this.db.connect();
    await conn.query("SET memory_limit='128MB'; SET autoinstall_known_extensions=false; SET autoload_known_extensions=false");
    for (const [table, rows] of Object.entries(dataset.tables)) {
      if (!rows.length) continue;
      const vectors = Object.fromEntries(Object.keys(rows[0]).map(column => {
        const values = rows.map(row => row[column]);
        const numeric = values.some(value => typeof value === 'number') && values.every(value => value === null || typeof value === 'number');
        return [column, numeric ? vectorFromArray(values as (number | null)[], new Float64()) : vectorFromArray(values.map(value => value === null ? null : String(value)), new Utf8())];
      }));
      // Arrow import is bundled and requires no JSON extension installation or
      // remote executable code. Exact nanosecond/int64 strings remain VARCHAR.
      await conn.insertArrowTable(new Table(vectors), { name: table });
    }
    // Lock the configuration after importing local buffers; user SQL cannot
    // re-enable network/file access, extension loading or raise the memory cap.
    await conn.query('SET enable_external_access=false; SET lock_configuration=true');
  }
  async query(sql: string): Promise<QueryResult> {
    if (!this.connection || this.stopped) throw Error('Load a telemetry export first.');
    // A single relational expression is prepared by DuckDB. Semicolons (even
    // inside strings) are intentionally unsupported; this is not the security
    // boundary. Locked external access is the actual I/O boundary.
    if (!sql.trim() || sql.length > 16000 || sql.includes(';')) throw Error('Enter one query without semicolons (up to 16,000 characters).');
    const statement = await this.connection.prepare(`SELECT * FROM (${sql}) AS result LIMIT 201`);
    try {
      const table = await statement.query();
      const columns = table.schema.fields.map(field => field.name);
      if (columns.length > 100) throw Error('Query exceeds the 100-column result limit.');
      let size = 0;
      const rows = table.toArray().slice(0, 200).map(row => columns.map(column => {
        const text = row[column] === null ? 'NULL' : String(row[column]);
        size += text.length;
        if (size > 1024 * 1024) throw Error('Query result exceeds 1 MiB. Select fewer/smaller columns.');
        return text;
      }));
      return { columns, rows, truncated: table.numRows > 200 };
    } finally { await statement.close(); }
  }
  dispose() { this.stopped = true; this.worker.terminate(); }
}

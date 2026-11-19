import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Pages serves static bytes without configurable Content-Encoding. Emit gzip as
// an explicit asset and decompress locally; do not raise the preview budget or
// fetch executable code from a CDN. The package/bytes are pinned by pnpm-lock.
export function duckdbAssets(): Plugin {
  const assets = [
    { id: 'virtual:duckdb-wasm-url', file: 'duckdb-eh.wasm.gz', package: '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm' },
    { id: 'virtual:mermaid-url', file: 'mermaid.tiny.js.gz', package: '@mermaid-js/tiny/dist/mermaid.tiny.js' },
  ];
  const cache = new Map<string, Buffer>();
  const bytes = (asset: typeof assets[number]) => {
    if (!cache.has(asset.id)) cache.set(asset.id, gzipSync(readFileSync(createRequire(new URL('./package.json', import.meta.url)).resolve(asset.package)), { level: 9 }));
    return cache.get(asset.id)!;
  };
  return {
    name: 'duckdb-compressed-asset',
    resolveId(id) { if (assets.some(asset => asset.id === id)) return '\0' + id; },
    load(id) {
      const asset = assets.find(asset => '\0' + asset.id === id);
      if (!asset) return;
      if (this.environment.mode === 'dev') return `export default "/@duckdb-assets/${asset.file}"`;
      const reference = this.emitFile({ type: 'asset', name: asset.file, source: bytes(asset) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference}`;
    },
    configureServer(server) {
      for (const asset of assets) server.middlewares.use('/@duckdb-assets/' + asset.file, (_req, res) => { res.setHeader('Content-Type', 'application/gzip'); res.end(bytes(asset)); });
    },
  };
}

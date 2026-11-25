import { describe, expect, it } from 'vitest';
import { decode, encode } from '@jridgewell/sourcemap-codec';
// @ts-expect-error Build tooling is JavaScript executed directly by Node in CI.
import { compactSourceMap } from '../scripts/compact-source-maps.mjs';

describe('production source map compaction', () => {
  it('preserves application positions and names without mapping vendor code to the application', () => {
    const map = {
      version: 3, sources: ['node_modules/vendor.js', 'src/app.ts', '[turbopack]/runtime.js'],
      sourcesContent: ['vendor source', 'application source', 'bundler source'], names: ['vendor', 'application'],
      mappings: encode([[[0, 0, 0, 0, 0], [5, 1, 2, 3, 1], [10, 0, 4, 5, 0], [15, 2, 0, 0], [20, 1, 6, 7, 1]], [[0, 0, 0, 0]]]),
    };
    const compacted = compactSourceMap(map);
    expect(compacted.sources).toEqual(['src/app.ts']);
    expect(compacted.sourcesContent).toEqual(['application source']);
    expect(compacted.names).toEqual(['application']);
    expect(decode(compacted.mappings)).toEqual([[[5, 0, 2, 3, 0], [10], [20, 0, 6, 7, 0]], []]);
    expect(compactSourceMap(compacted)).toEqual(compacted);
  });

  it('keeps a valid empty vendor-only map without adding embedded sources', () => {
    const map = compactSourceMap({ version: 3, sources: ['node_modules/vendor.js'], names: ['vendor'], mappings: encode([[[0, 0, 0, 0, 0]]]) });
    expect(map).toEqual({ version: 3, sources: [], names: [], mappings: '' });
  });
});

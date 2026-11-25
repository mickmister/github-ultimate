import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decode, encode } from '@jridgewell/sourcemap-codec';

export function compactSourceMap(map) {
  const sources = [], content = [], indices = new Map();
  for (const [index, source] of (map.sources ?? []).entries()) {
    if (source.includes('node_modules/') || source.includes('[turbopack]')) continue;
    indices.set(index, sources.length);
    sources.push(source);
    content.push(map.sourcesContent?.[index] ?? null);
  }
  const names = [], nameIndices = new Map();
  const lines = decode(map.mappings ?? '').map(line => line.map(segment => {
    // Retain an unmapped boundary: dropping a vendor segment would incorrectly
    // extend the previous application's mapping over dependency-generated code.
    if (segment.length === 1 || !indices.has(segment[1])) return [segment[0]];
    const next = [segment[0], indices.get(segment[1]), segment[2], segment[3]];
    if (segment.length === 5) {
      if (!nameIndices.has(segment[4])) {
        nameIndices.set(segment[4], names.length);
        names.push(map.names[segment[4]]);
      }
      next.push(nameIndices.get(segment[4]));
    }
    return next;
  }).filter((segment, index, segments) => segment.length !== 1 || (index > 0 && segments[index - 1].length !== 1)));
  return { ...map, sources, names, mappings: encode(lines), ...(map.sourcesContent ? { sourcesContent: content } : {}) };
}

/** Keep application debugging available without publishing the full dependency
 * source trees. Vendor-only maps remain valid empty maps for their JS links. */
export async function compactSourceMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compactSourceMaps(path);
    else if (entry.name.endsWith('.map')) {
      const map = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify(compactSourceMap(map)));
    }
  }
}

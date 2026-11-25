import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Keep application debugging available without publishing the full dependency
 * source trees. Vendor-only maps remain valid empty maps for their JS links. */
export async function compactSourceMaps(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compactSourceMaps(path);
    else if (entry.name.endsWith('.map')) {
      const map = JSON.parse(await readFile(path, 'utf8'));
      const own = (map.sources ?? []).map(source => !source.includes('node_modules/') && !source.includes('[turbopack]'));
      if (!own.some(Boolean)) await writeFile(path, JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }));
      else if (map.sourcesContent) {
        map.sourcesContent = map.sourcesContent.map((source, index) => own[index] ? source : null);
        await writeFile(path, JSON.stringify(map));
      }
    }
  }
}

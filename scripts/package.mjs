import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const files = {};
async function collect(prefix = '') {
  const entries = await readdir(`dist/${prefix}`, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await collect(`${name}/`);
    else if (entry.isFile()) files[name] = [new Uint8Array(await readFile(`dist/${name}`)), { mtime: new Date(2026, 0, 1, 0, 0, 0) }];
    else throw new Error(`Unsupported build entry: ${name}`);
  }
}
await collect();
await mkdir('release', { recursive: true });
const archive = zipSync(files, { level: 9 });
const name = `github-ultimate-chrome-${version}.zip`;
await writeFile(`release/${name}`, archive);
await writeFile(`release/${name}.sha256`, `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
console.log(`Packaged release/${name} (${archive.length} bytes)`);

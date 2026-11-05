import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/content.ts', 'src/popup.ts'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120', minify: true, legalComments: 'eof', loader: { '.css': 'text' } });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.version = pkg.version;
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
for (const file of ['popup.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(file, `dist/${file}`);
let licenses = '';
for (const name of Object.keys(pkg.dependencies)) {
  const directory = `node_modules/${name}`;
  const installed = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const { readdir } = await import('node:fs/promises');
  const names = (await readdir(directory)).filter(file => /^licen[sc]e(?:\.|$)/i.test(file));
  if (!names.length) throw new Error(`Missing runtime license for ${name}`);
  licenses += `\n${'='.repeat(72)}\n${name} ${installed.version} — ${installed.license}\n`;
  for (const file of names) licenses += `\n${await readFile(`${directory}/${file}`, 'utf8')}\n`;
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', licenses);
console.log(`Built GitHub Ultimate ${pkg.version}`);

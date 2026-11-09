import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const browser = process.argv[2] ?? 'chrome';
if (!['chrome', 'safari'].includes(browser)) throw new Error(`Unknown browser target: ${browser}`);
const outdir = browser === 'safari' ? 'dist-safari' : 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['src/content.ts', 'src/popup.ts', 'src/background.ts', 'src/connections-page.ts'], outdir, bundle: true, format: 'iife', target: browser === 'safari' ? 'safari16.4' : 'chrome120', minify: true, legalComments: 'eof', loader: { '.css': 'text' } });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.version = pkg.version;
// Chromium requires a numeric version; version_name is the display string.
// Read the actual checkout, not an environment variable that may identify a
// different source revision. Dirty local builds must not masquerade as clean.
const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cannot identify extension source commit.');
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
manifest.version_name = `${pkg.version}+${commit.slice(0, 8)}${dirty ? '-dirty' : ''}`;
if (browser === 'safari') {
  delete manifest.minimum_chrome_version;
  manifest.background = { scripts: ['background.js'], persistent: false };
}
await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const popup = await readFile('popup.html', 'utf8');
await writeFile(`${outdir}/popup.html`, popup.replace('__BUILD_VERSION__', manifest.version_name));
await copyFile('connections.html', `${outdir}/connections.html`);
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(file, `${outdir}/${file}`);
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
await writeFile(`${outdir}/THIRD_PARTY_LICENSES.txt`, licenses);
console.log(`Built GitHub Ultimate ${manifest.version_name} for ${browser} in ${outdir}/`);

import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { bundleLicenses } from './bundle-licenses.mjs';

const outdir = 'hosted-dist/pi';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
// Keep the optional agent POC out of ordinary workspace page bundles.
const pi = await build({ entryPoints: ['hosted/pi.ts'], outdir, entryNames: 'pi-[hash]', bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'safari16.4'], minify: true, metafile: true, define: { PI_LEGACY_POC: 'true' } });
const output = Object.entries(pi.metafile.outputs).find(([, value]) => value.entryPoint === 'hosted/pi.ts');
if (!output?.[1].cssBundle) throw new Error('Pi POC assets missing.');
await writeFile(`${outdir}/THIRD_PARTY_LICENSES.txt`, await bundleLicenses(pi.metafile));
await writeFile(`${outdir}/index.html`, (await readFile('hosted/pi.html', 'utf8')).replace('./pi.ts', './' + output[0].slice(outdir.length + 1)).replace('</head>', `<link rel="stylesheet" href="./${output[1].cssBundle.slice(outdir.length + 1)}"></head>`));
// Preserve the published POC address without pulling its runtime into the small
// legacy-pages directory. The entire Pi application has its own payload budget.
await writeFile('hosted-dist/pi.html', '<!doctype html><meta http-equiv="refresh" content="0;url=./pi/index.html"><a href="./pi/index.html">Open Pi agent POC</a>\n');

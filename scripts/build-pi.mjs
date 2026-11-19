import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bundleLicenses } from './bundle-licenses.mjs';

await mkdir('hosted-dist', { recursive: true });
// Keep the optional agent POC out of ordinary workspace page bundles.
const pi = await build({ entryPoints: ['hosted/pi.ts'], outdir: 'hosted-dist', entryNames: 'pi-[hash]', bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'safari16.4'], minify: true, metafile: true });
const output = Object.entries(pi.metafile.outputs).find(([, value]) => value.entryPoint === 'hosted/pi.ts');
if (!output?.[1].cssBundle) throw new Error('Pi POC assets missing.');
await writeFile('hosted-dist/PI_THIRD_PARTY_LICENSES.txt', await bundleLicenses(pi.metafile));
await writeFile('hosted-dist/pi.html', (await readFile('hosted/pi.html', 'utf8')).replace('./pi.ts', './' + output[0].slice('hosted-dist/'.length)).replace('</head>', `<link rel="stylesheet" href="./${output[1].cssBundle.slice('hosted-dist/'.length)}"></head>`));

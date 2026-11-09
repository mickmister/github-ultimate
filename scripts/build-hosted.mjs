import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const metadata = {
  branch: process.env.GITHUB_REF_NAME ?? execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
};
await rm('hosted-dist', { recursive: true, force: true });
await mkdir('hosted-dist', { recursive: true });
await build({ entryPoints: ['hosted/main.ts'], outdir: 'hosted-dist', bundle: true, format: 'esm', target: ['chrome120', 'safari16.4'], minify: true, sourcemap: false, define: { __HOSTED_BUILD__: JSON.stringify(metadata) } });
const html = (await readFile('hosted/index.html', 'utf8')).replace('./main.ts', './main.js').replace('</head>', '<link rel="stylesheet" href="./main.css"></head>');
await writeFile('hosted-dist/index.html', html);
await writeFile('hosted-dist/build.json', JSON.stringify(metadata) + '\n');
console.log(`Built hosted page for ${metadata.branch} at ${metadata.sha}`);

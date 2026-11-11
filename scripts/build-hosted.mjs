import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { previewDirectory, payloadSize, previewLimit } from './publish-hosted.mjs';

const metadata = {
  branch: process.env.GITHUB_REF_NAME ?? execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
};
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'github-ultimate';
const webappBase = `/${repositoryName}/previews/${previewDirectory(metadata.branch)}/app/`;
await rm('hosted-dist', { recursive: true, force: true });
await mkdir('hosted-dist', { recursive: true });
const built = await build({ entryPoints: ['hosted/main.ts', 'hosted/settings.ts', 'hosted/s3.ts'], outdir: 'hosted-dist', entryNames: '[name]-[hash]', chunkNames: 'shared-[hash]', splitting: true, bundle: true, format: 'esm', target: ['chrome120', 'safari16.4'], minify: true, sourcemap: false, metafile: true, define: { __HOSTED_BUILD__: JSON.stringify(metadata) } });
for (const [entry, page] of [['main', 'index'], ['settings', 'settings'], ['s3', 's3']]) {
  const output = Object.entries(built.metafile.outputs).find(([, value]) => value.entryPoint === `hosted/${entry}.ts`);
  if (!output?.[1].cssBundle) throw new Error(`Hosted assets missing for ${entry}.`);
  const script = output[0].slice('hosted-dist/'.length), stylesheet = output[1].cssBundle.slice('hosted-dist/'.length);
  const html = (await readFile(`hosted/${page}.html`, 'utf8')).replace(`./${entry}.ts`, `./${script}`).replace('</head>', `<link rel="stylesheet" href="./${stylesheet}"></head>`);
  await writeFile(`hosted-dist/${page}.html`, html);
}
await writeFile('hosted-dist/build.json', JSON.stringify(metadata) + '\n');
execFileSync('pnpm', ['--dir', 'webapp', 'build'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', WEBAPP_BASE_PATH: webappBase } });
// Start's server build is used only to generate the SPA shell. Publish only
// client files: GitHub Pages does not run a server or server functions.
await cp('webapp/dist/client', 'hosted-dist/app', { recursive: true });
await cp('webapp/node_modules/monaco-editor/LICENSE', 'hosted-dist/app/MONACO_LICENSE.txt');
await cp('webapp/node_modules/monaco-editor/ThirdPartyNotices.txt', 'hosted-dist/app/MONACO_THIRD_PARTY_NOTICES.txt');
if (await payloadSize('hosted-dist') > previewLimit) throw new Error('Hosted pages exceed the branch preview payload limit.');
console.log(`Built hosted page for ${metadata.branch} at ${metadata.sha}`);

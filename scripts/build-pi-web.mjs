import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { payloadSize, previewDirectory } from './publish-hosted.mjs';
import { build } from 'esbuild';

export async function buildPiWeb(metadata, output = 'hosted-dist/pi-web') {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'github-ultimate';
  const base = `/${repository}/previews/${previewDirectory(metadata.branch)}/pi-web`;
  execFileSync('npm', ['run', 'build'], {
    cwd: resolve('pi-web/demo'), stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PAGES_BASE_PATH: base },
  });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp('pi-web/demo/out', output, { recursive: true });
  await build({ entryPoints: ['hosted/pi-web-runtime.ts'], outfile: `${output}/extension-runtime.js`, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false });
  await cp('pi-web/LICENSE', `${output}/PI_WEB_LICENSE.txt`);
  await writeFile(`${output}/build.json`, JSON.stringify({ ...metadata, basePath: `${base}/`, demo: true, upstream: { repository: 'agegr/pi-web', commit: '432366bd510c72ce7b678a6cb1220f9cac1ed56c' } }) + '\n');
  if (await payloadSize(output) > 12 * 1024 * 1024) throw new Error('Pi Web demo exceeds its 12 MiB payload budget.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPiWeb({
    branch: process.env.GITHUB_REF_NAME ?? execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  });
}

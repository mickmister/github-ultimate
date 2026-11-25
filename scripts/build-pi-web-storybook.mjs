import { execFileSync } from 'node:child_process';
import { writeFile, cp } from 'node:fs/promises';
import { payloadSize, piWebStorybookLimit } from './publish-hosted.mjs';

execFileSync('npm', ['--prefix', 'pi-web/client', 'run', 'storybook:build'], { stdio: 'inherit' });
const output = 'pi-web/client/storybook-static';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile(`${output}/build.json`, JSON.stringify({ kind: 'pi-web-storybook', sha, storiesOnly: true }) + '\n');
await cp('pi-web/LICENSE', `${output}/PI_WEB_LICENSE.txt`);
await cp('pi-web/client/node_modules/@fontsource-variable/noto-sans-mono/LICENSE', `${output}/NOTO_SANS_MONO_LICENSE.txt`);
if (await payloadSize(output) > piWebStorybookLimit) throw Error('Pi Web Storybook exceeds its 14 MiB payload budget.');

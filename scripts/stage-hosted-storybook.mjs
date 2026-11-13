import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { payloadSize, previewLimit } from './publish-hosted.mjs';

export async function stageHostedStorybook({ source = 'webapp/storybook-static', output = 'hosted-dist' } = {}) {
  // Validate both builds before replacing the previous staged Storybook.
  const metadata = JSON.parse(await readFile(join(output, 'build.json'), 'utf8'));
  if (!/^[a-f0-9]{40,64}$/.test(metadata.sha) || !metadata.branch) throw new Error('Build the hosted app before staging Storybook.');
  await Promise.all(['index.html', 'iframe.html', 'index.json'].map(file => readFile(join(source, file))));
  await payloadSize(source); // Reject links and non-regular artifacts.
  const destination = join(output, 'storybook');
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, {
    recursive: true,
    filter: path => !path.endsWith('.map') && basename(path) !== 'project.json',
  });
  await writeFile(join(destination, 'build.json'), JSON.stringify(metadata) + '\n');
  for (const name of ['MONACO_LICENSE.txt', 'MONACO_THIRD_PARTY_NOTICES.txt']) {
    await cp(join(output, 'app', name), join(destination, name));
  }
  const bytes = await payloadSize(output);
  if (bytes > previewLimit) throw new Error('Hosted app and Storybook exceed the branch preview payload limit.');
  return { bytes, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await stageHostedStorybook()));
}

import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  // Mermaid is a standalone script loaded by URL, identical in both builds.
  // Share its bytes while preserving each build's independently bundled modules.
  const assets = join(destination, 'assets');
  const names = await readdir(assets).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const name of names.filter(name => /^mermaid\.tiny-[\w-]+\.js$/.test(name))) {
    const shared = await readFile(join(output, 'app', 'assets', name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!shared || !shared.equals(await readFile(join(assets, name)))) continue;
    let referenced = false;
    for (const module of names.filter(file => file !== name && file.endsWith('.js'))) {
      const path = join(assets, module), text = await readFile(path, 'utf8');
      const next = text.replaceAll(JSON.stringify(name), JSON.stringify(`../../app/assets/${name}`));
      if (next !== text) { await writeFile(path, next); referenced = true; }
    }
    if (referenced) await rm(join(assets, name));
  }
  const bytes = await payloadSize(output);
  if (bytes > previewLimit) throw new Error('Hosted app and Storybook exceed the branch preview payload limit.');
  return { bytes, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await stageHostedStorybook()));
}

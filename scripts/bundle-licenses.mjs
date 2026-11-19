import { readFile, readdir } from 'node:fs/promises';

// License only packages included in these browser bundles, not unused provider
// SDKs and their Node-only dependency trees. Fail closed on missing notices.
export async function bundleLicenses(metafile) {
  const directories = new Set(Object.keys(metafile.inputs).map(path => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]).filter(Boolean));
  const seen = new Set(); let result = '';
  for (const directory of [...directories].sort()) {
    const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
    const identity = `${pkg.name}@${pkg.version}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const names = (await readdir(directory)).filter(file => /^licen[sc]e(?:\.|$)/i.test(file));
    const override = identity === '@nodable/entities@3.1.0' ? 'licenses/nodable-val-parsers-MIT.txt'
      : /^@earendil-works\/pi-(agent-core|ai|schema|telemetry)@1\.5\.2$/.test(identity) ? 'licenses/pi-MIT.txt' : undefined;
    if (!names.length && !override) throw new Error(`Missing bundled license for ${identity}`);
    result += `\n${identity} — ${pkg.license}\n`;
    for (const name of names) result += await readFile(`${directory}/${name}`, 'utf8') + '\n';
    if (!names.length) result += await readFile(override, 'utf8') + '\n';
  }
  return result;
}

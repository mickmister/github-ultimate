import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, cp, lstat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Bound the app + mock-data Storybook, including their local Monaco assets.
export const previewLimit = 24 * 1024 * 1024;
export const siteLimit = 50 * 1024 * 1024;
export function previewDirectory(branch) {
  return `b-${branch.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${createHash('sha256').update(branch).digest('hex').slice(0, 16)}`;
}
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function payloadSize(directory) {
  let size = 0;
  for (const entry of await readdir(directory)) {
    if (entry === '.git') continue;
    const path = join(directory, entry), stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Pages payload must contain only regular files/directories.');
    size += stat.isDirectory() ? await payloadSize(path) : stat.size;
  }
  return size;
}

// One current tree per branch; no per-commit copies, source maps, dependencies,
// test recordings or extension ZIPs. Git history is ordinary append-only history
// (not force-squashed); its cumulative storage is intentionally not claimed bounded.
export async function publishHosted({ remote, source, output, branch, sha, token, deleted = false }) {
  if (!branch || branch === 'gh-pages' || !/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid source branch or SHA.');
  if (!deleted && await payloadSize(source) > previewLimit) throw new Error('Hosted preview exceeds the 24 MiB payload limit.');
  if (!deleted && (!await readFile(join(source, 'index.html'), 'utf8') || JSON.parse(await readFile(join(source, 'build.json'), 'utf8')).sha !== sha)) throw new Error('Built hosted page does not match the source SHA.');
  const directory = await mkdtemp(join(tmpdir(), 'github-ultimate-pages-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com', GIT_COMMITTER_NAME: 'github-actions[bot]', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com', GIT_TERMINAL_PROMPT: '0' };
  if (token) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` });
  function git(args) {
    try { return execFileSync('git', args, { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { throw new Error(`Pages git ${args[0]} failed. No credential-bearing command output is logged.`); }
  }
  try {
    git(['init', '--initial-branch=gh-pages']); git(['remote', 'add', 'origin', remote]);
    const heads = new Map(git(['ls-remote', '--heads', 'origin']).split('\n').filter(Boolean).map(line => { const [oid, ref] = line.split(/\s+/); return [ref.slice('refs/heads/'.length), oid]; }));
    if (!deleted && heads.get(branch) !== sha) return { skipped: true, reason: 'Source branch moved or was deleted; a newer successful build should publish.' };
    if (heads.has('gh-pages')) {
      git(['fetch', '--depth=1', 'origin', 'gh-pages']); git(['reset', '--hard', 'FETCH_HEAD']);
    }
    const manifestPath = join(directory, 'previews.json');
    let manifest = Object.create(null);
    try { manifest = Object.assign(Object.create(null), JSON.parse(await readFile(manifestPath, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Existing Pages preview manifest is unreadable.'); }
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Invalid preview manifest.');
    for (const [name, entry] of Object.entries(manifest)) {
      if (entry.directory !== previewDirectory(name)) throw new Error('Existing preview manifest contains an invalid directory.');
      if (!heads.has(name) || name === 'gh-pages') {
        await rm(join(directory, 'previews', entry.directory), { recursive: true, force: true }); delete manifest[name];
      }
    }
    const target = join(directory, 'previews', previewDirectory(branch));
    if (deleted) {
      if (heads.has(branch)) return { skipped: true, reason: 'Branch exists again; preserve its current preview.' };
      await rm(target, { recursive: true, force: true }); delete manifest[branch];
    } else {
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true }); await cp(source, target, { recursive: true });
      manifest[branch] = { directory: previewDirectory(branch), sha };
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const links = (await Promise.all(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)).map(async ([name, entry]) => {
      let storybook = '';
      try {
        await access(join(directory, 'previews', entry.directory, 'storybook', 'index.html'));
        storybook = ` · <a href="./previews/${entry.directory}/storybook/">Storybook</a>`;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return `<li><a href="./previews/${entry.directory}/">${escape(name)}</a> <code>${entry.sha.slice(0, 12)}</code>${storybook}</li>`;
    }))).join('\n');
    await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub Ultimate branch previews</title><body><h1>GitHub Ultimate branch previews</h1><p>One current hosted bridge demo per branch. All preview paths share one origin.</p><ul>${links}</ul></body></html>\n`);
    await writeFile(join(directory, '.nojekyll'), '');
    if (await payloadSize(directory) > siteLimit) throw new Error('Pages site exceeds 50 MiB. Publication stopped without changing gh-pages.');
    // Recheck just before publication: never let an older completed build roll
    // back a branch preview. Global workflow concurrency serializes publishers.
    const currentHead = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0];
    if (!deleted && currentHead !== sha) return { skipped: true, reason: 'Source branch advanced during publication.' };
    if (deleted && currentHead) return { skipped: true, reason: 'Branch was recreated during cleanup.' };
    git(['add', '--all']);
    const changed = Boolean(git(['diff', '--cached', '--name-only']));
    if (changed) { git(['commit', '-m', `${deleted ? 'Remove' : 'Update'} hosted preview for ${branch}`]); git(['push', 'origin', 'HEAD:refs/heads/gh-pages']); }
    await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
    for (const entry of await readdir(directory)) if (entry !== '.git') await cp(join(directory, entry), join(output, entry), { recursive: true });
    return { skipped: false, changed, directory: deleted ? undefined : `previews/${previewDirectory(branch)}`, previewCount: Object.keys(manifest).length, siteBytes: await payloadSize(output) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: branch, GITHUB_SHA: sha, GITHUB_TOKEN: token } = process.env;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) throw new Error('Missing repository-scoped publication configuration.');
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
    const deleted = process.env.GITHUB_EVENT_NAME === 'delete';
    if (deleted && event.ref_type !== 'branch') throw new Error('Only branch deletion is supported.');
    const selectedBranch = deleted ? event.ref : branch;
    const result = await publishHosted({ remote: `https://github.com/${repository}.git`, source: resolve('hosted-dist'), output: resolve('pages-site'), branch: selectedBranch, sha, token, deleted });
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `skipped=${result.skipped}\npreview_path=${result.directory ?? ''}\n`, { flag: 'a' });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

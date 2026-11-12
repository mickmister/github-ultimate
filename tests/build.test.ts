import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

for (const browser of ['chrome', 'safari']) {
  test(`${browser} build identifies the actual checkout in its manifest and popup`, () => {
    const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    const display = `${version}+${commit.slice(0, 8)}${dirty ? '-dirty' : ''}`;
    // A stale CI variable must not label a different checkout as that commit.
    execFileSync(process.execPath, ['scripts/build.mjs', browser], { env: { ...process.env, GITHUB_SHA: '0'.repeat(40) } });
    const directory = browser === 'safari' ? 'dist-safari' : 'dist';
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    expect(manifest.version).toBe(version);
    expect(manifest.version).toMatch(/^\d+(?:\.\d+){0,3}$/);
    expect(manifest.version_name).toBe(display);
    expect(readFileSync(`${directory}/popup.html`, 'utf8')).toContain(`Version ${display}`);
    expect(readFileSync(`${directory}/popup.html`, 'utf8')).not.toContain('__BUILD_VERSION__');
    expect(manifest.options_ui.page).toBe('connections.html');
    expect(manifest.host_permissions).toEqual(['https://github.com/*', 'https://api.github.com/*']);
    expect(manifest.background).toEqual(browser === 'safari' ? { scripts: ['background.js'], persistent: false } : { service_worker: 'background.js' });
    expect(readFileSync(`${directory}/connections.html`, 'utf8')).toContain('connections-page.js');
    expect(readFileSync(`${directory}/background.js`, 'utf8')).toContain('github-ultimate-connections-v1');
    if (browser === 'chrome') {
      execFileSync(process.execPath, ['scripts/package.mjs']);
      const archive = unzipSync(readFileSync(`release/github-ultimate-chrome-${version}.zip`));
      expect(archive['manifest.json']).toEqual(new Uint8Array(readFileSync(`${directory}/manifest.json`)));
      for (const path of Object.values(manifest.icons) as string[]) {
        expect(archive[path]).toEqual(new Uint8Array(readFileSync(`${directory}/${path}`)));
      }
    }
  // These are full packaging checks, including high-resolution icon generation.
  // Allow CI runners more than Vitest's five-second unit-test default.
  }, 120000);
}

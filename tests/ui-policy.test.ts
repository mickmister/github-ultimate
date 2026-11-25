import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { checkUI, type Policy } from '../scripts/ui-policy';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gu-ui-policy-')); roots.push(root);
  const put = (file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  const dir = 'webapp/src/features/pilot';
  put('webapp/src/presentation/Presentation.tsx', 'export const defineDevicePage = (value: unknown) => value; export const defineDeviceRegion = defineDevicePage;');
  put('webapp/src/routes/pilot.tsx', `import { Host } from '../features/pilot/Host'; export const Route = { component: Host };`);
  put(`${dir}/Host.tsx`, `import { usePilot } from './Pilot.hooks'; import { Page } from './Page'; export function Host() { const props = usePilot(); return <Page {...props} />; }`);
  put(`${dir}/Pilot.hooks.ts`, 'export function usePilot() { return {}; }');
  put(`${dir}/Pilot.copy.ts`, `export const copy = { title: { purpose: 'heading', text: 'Pilot' } };`);
  for (const surface of ['phone', 'tablet', 'desktop']) put(`${dir}/Pilot.${surface}.view.tsx`, `export function View() { return <main data-surface="${surface}"><section /></main>; }`);
  const page = `import { defineDevicePage } from '../../presentation/Presentation'; import { View as Phone } from './Pilot.phone.view'; import { View as Tablet } from './Pilot.tablet.view'; import { View as Desktop } from './Pilot.desktop.view'; export const Page = defineDevicePage({ id: 'pilot', phone: Phone, tablet: Tablet, desktop: Desktop });`;
  put(`${dir}/Page.tsx`, page);
  put('webapp/stories/Pilot.stories.tsx', ['PhonePortrait', 'PhoneLandscape', 'TabletPortrait', 'TabletLandscape', 'DesktopPortrait', 'DesktopLandscape'].map(name => `export const ${name} = {};`).join('\n'));
  const policy: Policy = { schema_version: 1, features: [{ id: 'pilot', host: `${dir}/Host.tsx`, hooks: `${dir}/Pilot.hooks.ts`, hook: 'usePilot', copy: `${dir}/Pilot.copy.ts`, ownedViews: [], presentations: [{ id: 'pilot', kind: 'page', file: `${dir}/Page.tsx`, export: 'Page' }], scenarios: 'webapp/stories/Pilot.stories.tsx' }], routes: { 'webapp/src/routes/pilot.tsx': { feature: 'pilot' } }, legacyRoutes: {}, exceptions: [] };
  return { root, put, policy, dir, page, rules: () => checkUI(root, policy).map(d => d.rule_id) };
}
describe('UI policy rejects architectural bypasses', () => {
  it('accepts distinct production views and feature hooks', () => { const f = fixture(); expect(f.rules()).toEqual([]); });
  it('rejects a missing tablet implementation', () => { const f = fixture(); f.put(`${f.dir}/Page.tsx`, f.page.replace('tablet: Tablet, ', '')); expect(f.rules()).toContain('ui/device-surfaces'); });
  it('resolves barrel aliases rather than trusting filenames', () => {
    const f = fixture(); f.put(`${f.dir}/Pilot.tablet.view.tsx`, `export { View } from './Pilot.desktop.view';`);
    expect(f.rules()).toContain('ui/device-surfaces');
  });
  it('rejects a nominal view that only forwards', () => {
    const f = fixture(); f.put(`${f.dir}/Pilot.phone.view.tsx`, `import { View as Shared } from './Pilot.desktop.view'; export function View() { return <Shared />; }`);
    expect(f.rules()).toContain('ui/no-forwarding-device-page'); expect(f.rules()).toContain('ui/device-page-boundaries');
  });
  it('rejects new unregistered routes', () => { const f = fixture(); f.put('webapp/src/routes/unregistered.tsx', 'export const Route = {};'); expect(f.rules()).toContain('ui/route-surfaces'); });
  it('does not let a new route opt into the legacy migration baseline', () => {
    const f = fixture(), path = 'webapp/src/routes/new.tsx'; f.put(path, 'export const Route = {};');
    f.policy.legacyRoutes[path] = { owner: 'task-test', reason: 'Attempted new-route escape hatch.' };
    expect(f.rules()).toContain('ui/migration-validity');
  });
  it('rejects unused hook declarations and missing landscape scenarios', () => {
    const f = fixture(); f.put(`${f.dir}/Host.tsx`, `import { Page } from './Page'; export const Host = Page;`); f.put('webapp/stories/Pilot.stories.tsx', 'export const PhonePortrait = {};');
    expect(f.rules()).toContain('ui/feature-hooks-boundary'); expect(f.rules()).toContain('ui/orientation-coverage');
  });
  it('rejects rendered literals and accessible-label literals, not structural attributes', () => {
    const f = fixture(); f.put(`${f.dir}/Pilot.phone.view.tsx`, `export function View() { return <main className="frame"><button aria-label="Save">Save</button></main>; }`);
    expect(f.rules().filter(r => r === 'ui/no-raw-app-copy')).toHaveLength(2);
  });
  it('rejects cataloged helper prose without a reviewed exception', () => {
    const f = fixture(); f.put(`${f.dir}/Pilot.copy.ts`, `export const help = { purpose: 'helper', text: 'Click the button to save.' };`);
    expect(f.rules()).toContain('ui/contextual-help-only');
  });
  it('follows a rendered constant instead of allowing JSX-expression opt-outs', () => {
    const f = fixture(); f.put(`${f.dir}/Pilot.phone.view.tsx`, `const hint = 'Click save to save.'; export function View() { return <main>{hint}</main>; }`);
    expect(f.rules()).toContain('ui/no-raw-app-copy');
  });
  it('blocks native UI imports even outside the adopted pilot', () => {
    const f = fixture(); f.put('mobile/Settings.tsx', 'export const NativeSettings = () => null;');
    f.put('webapp/src/leak.tsx', `import { NativeSettings } from '../../mobile/Settings'; export const Leak = NativeSettings;`);
    expect(f.rules()).toContain('ui/native-settings-ownership');
  });
  it('accepts an exact reasoned exception and fails stale or expired ones', () => {
    const f = fixture(), file = `${f.dir}/Pilot.copy.ts`, text = `export const help = { purpose: 'helper', text: 'First-time setup.' };`;
    f.put(file, text); f.policy.exceptions.push({ rule: 'ui/contextual-help-only', file, fingerprint: createHash('sha256').update(text).digest('hex'), owner: 'task-test', reason: 'Required setup guidance, only inside setup disclosure.', reviewBy: '2099-01-01' });
    expect(f.rules()).toEqual([]); f.policy.exceptions[0].reviewBy = '2000-01-01'; expect(f.rules()).toContain('ui/copy-exception-validity');
    f.policy.exceptions[0].reviewBy = '2099-01-01'; f.put(file, 'export const copy = {};'); expect(f.rules()).toContain('ui/copy-exception-validity');
  });
  it('checks the checked-in migration inventory and production contracts', () => {
    const policy = JSON.parse(readFileSync('.github/openlint/ui-contracts.json', 'utf8')) as Policy;
    expect(checkUI(process.cwd(), policy)).toEqual([]);
  }, 20000);
});

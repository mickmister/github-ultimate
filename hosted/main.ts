import { bridgeRequest } from './client';
import type { HostedConnection } from '../src/hosted-protocol';
import { WorkspaceCatalog, workspaceKey, type WorkspaceAccess } from './catalog';
import { WorkspaceReader } from './workspaces';
import { loadNavigation, saveNavigation } from './navigation';
import { parseRoute, workspaceURL, type WorkspaceRoute } from './routes';
import { githubDevURL } from './github-dev';
import { workspaceApps } from './workspace-apps';
import { element, externalLink } from './components';
import './dashboard.css';

declare const __HOSTED_BUILD__: { branch: string; sha: string };
const root = document.getElementById('dashboard')!;
const status = document.getElementById('dashboard-status')!;
document.getElementById('dashboard-build')!.textContent = `${__HOSTED_BUILD__.branch} · ${__HOSTED_BUILD__.sha.slice(0, 12)}`;
let current = new AbortController();
let catalog: WorkspaceCatalog | undefined;
const remembered = () => loadNavigation();
function report(message: string) { status.textContent = message; }

async function connections() {
  const capability = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' }, 5000);
  if (!Array.isArray(capability.capabilities) || !capability.capabilities.includes('implicitWorkspaces')) throw new Error('Update the extension and reload this page to enable workspace discovery.');
  return bridgeRequest<HostedConnection[]>({ operation: 'connections' });
}

function routeFor(access: WorkspaceAccess) {
  return { connectionId: access.connection.id, installationId: access.connection.installation!.id, repository: access.repository, workspace: access.workspace.name };
}
function remember(access: WorkspaceAccess) {
  saveNavigation({ ...routeFor(access), discovered: true });
}
function description(access: WorkspaceAccess) {
  return access.opened.manifest.purpose || `${access.opened.manifest.repositories?.length ?? 0} attached repositories`;
}

function renderCards(container: HTMLElement, active: () => boolean) {
  container.replaceChildren();
  const saved = remembered();
  for (const [key, routes] of catalog!.workspaces) {
    const card = element('article', undefined, 'workspace-card');
    card.append(element('h2', routes[0].workspace.name), element('p', description(routes[0])), element('p', routes[0].repository, 'muted'));
    const tags = element('p', undefined, 'tags');
    tags.append(element('span', routes.some(route => route.workspace.dolt) ? 'Beads' : 'No Beads snapshot'), element('span', 'Documents'));
    const savedWorkspace = saved && workspaceKey(saved.repository, saved.workspace ?? '') === key;
    if (savedWorkspace) tags.append(element('span', 'Last opened'));
    card.append(tags);
    const previous = routes.find(route => route.connection.id === saved?.connectionId && route.connection.installation?.id === saved.installationId);
    const chosen = previous ?? (!savedWorkspace && routes.length === 1 ? routes[0] : undefined);
    const select = element('select'); select.setAttribute('aria-label', `Access route for ${routes[0].workspace.name}`);
    const placeholder = element('option', 'Choose an approved access route'); placeholder.value = ''; select.append(placeholder);
    routes.forEach((route, index) => { const option = element('option', `${route.connection.name} · ${route.connection.installation!.account}`); option.value = String(index); select.append(option); });
    if (chosen) select.value = String(routes.indexOf(chosen));
    const open = element('a', `Open ${routes[0].workspace.name}`, 'button');
    const update = () => {
      const selected = select.value === '' ? undefined : routes[Number(select.value)];
      if (selected) { open.href = workspaceURL(routeFor(selected)); open.removeAttribute('aria-disabled'); }
      else { open.removeAttribute('href'); open.setAttribute('aria-disabled', 'true'); }
    };
    select.addEventListener('change', update); update();
    if (routes.length > 1 || !chosen) card.append(select);
    open.addEventListener('click', event => { if (!active() || !open.hasAttribute('href')) event.preventDefault(); });
    card.append(open); container.append(card);
  }
}

async function chooser(available: HostedConnection[], signal: AbortSignal) {
  root.append(element('h1', 'Workspaces'), element('p', 'Choose a workspace to open its engineering apps.', 'muted'));
  const controls = element('div', undefined, 'toolbar'), refresh = element('button', 'Refresh workspaces');
  controls.append(refresh); root.append(controls);
  const cards = element('div', undefined, 'workspace-grid'), notices = element('details', undefined, 'discovery-notices'), more = element('button', 'Load more workspaces');
  root.append(cards, more, notices);
  const active = () => !signal.aborted;
  let busy = false;
  const load = async () => {
    if (busy || !active()) return;
    busy = true; refresh.disabled = more.disabled = true;
    try {
      await catalog!.loadMore(message => { if (active()) report(message); }, active, () => { if (active()) renderCards(cards, active); });
      if (!active()) return;
      renderCards(cards, active);
      more.hidden = !catalog!.queue.length;
      notices.replaceChildren(element('summary', `${catalog!.incomplete} incomplete namespace(s) · ${catalog!.notices.length} discovery notice(s)`));
      notices.open = catalog!.notices.length > 0;
      for (const message of catalog!.notices) notices.append(element('p', message));
      report(`${catalog!.workspaces.size} available workspace(s).${catalog!.queue.length ? ' More repositories or namespaces remain; load another bounded batch.' : ''}${catalog!.incomplete ? ' Namespaces without a valid required manifest are omitted.' : ''}${catalog!.notices.length ? ' Some access routes need attention; see discovery notices below.' : ''}`);
      if (!catalog!.workspaces.size) cards.append(element('p', 'No valid workspaces found in this batch. Check connection access in Settings or load more results.', 'empty'));
    } catch (error) { if (active()) report(error instanceof Error ? error.message : 'Workspace discovery failed.'); }
    finally { busy = false; refresh.disabled = more.disabled = false; }
  };
  refresh.addEventListener('click', () => void render());
  more.addEventListener('click', () => void load());
  if (!available.length) { more.hidden = true; report('No approved signed-in connections. Open Settings to configure extension access.'); return; }
  catalog = new WorkspaceCatalog(bridgeRequest, available, remembered()?.repository);
  refresh.disabled = more.disabled = true;
  await catalog.prepare(message => { if (active()) report(message); }, active);
  if (!active()) return;
  await load();
}

async function resolveWorkspace(route: WorkspaceRoute, available: HostedConnection[], signal: AbortSignal) {
  const connection = available.find(connection => connection.id === route.connectionId);
  if (!connection || connection.installation?.id !== route.installationId) throw new Error('This workspace’s saved connection or installation is unavailable. Return to Workspaces and choose an approved access route; no fallback was used.');
  const cached = catalog?.workspaces.get(workspaceKey(route.repository, route.workspace))?.find(access => access.connection.id === route.connectionId && access.connection.installation?.id === route.installationId);
  if (cached) return cached;
  const reader = new WorkspaceReader(bridgeRequest, connection.id, route.repository, route.installationId, route.workspace);
  const found = await reader.discover();
  if (signal.aborted) throw new Error('Navigation changed.');
  const workspace = found.find(workspace => workspace.name === route.workspace);
  if (!workspace) throw new Error('This workspace namespace is no longer available.');
  const opened = await reader.open(workspace);
  return { connection, repository: route.repository, workspace, opened } satisfies WorkspaceAccess;
}

async function detail(route: WorkspaceRoute, available: HostedConnection[], signal: AbortSignal) {
  report('Opening workspace and verifying its manifest…');
  const access = await resolveWorkspace(route, available, signal);
  if (signal.aborted) return;
  remember(access);
  const header = element('header', undefined, 'workspace-header'), back = element('a', '← Workspaces'); back.href = '#/';
  const heading = element('div'); heading.append(element('h1', access.workspace.name), element('p', description(access), 'muted'), element('p', `${access.repository} · ${access.connection.name} · ${access.connection.installation!.account}`, 'muted'));
  header.append(back, heading, externalLink('Open in github.dev', githubDevURL(access.repository, access.opened.snapshot.commit)));
  root.append(header);
  const tabs = element('nav', undefined, 'app-tabs'); tabs.setAttribute('aria-label', 'Workspace apps');
  for (const app of workspaceApps.values()) {
    const link = element('a', app.title); link.href = workspaceURL(route, app.id);
    if (app.id === route.app) link.setAttribute('aria-current', 'page'); tabs.append(link);
  }
  const appRoot = element('section', undefined, 'app-view');
  root.append(tabs, appRoot);
  const app = workspaceApps.get(route.app);
  if (!app) { appRoot.append(element('p', 'This workspace app is not installed. Choose an available app above.')); report('Workspace opened.'); return; }
  report(`Workspace opened · ${app.title}`);
  const module = await app.load();
  if (signal.aborted) return;
  await module.mount(appRoot, { ...access, reader: new WorkspaceReader(bridgeRequest, access.connection.id, access.repository, access.connection.installation!.id, access.workspace.name), signal });
}

async function render() {
  current.abort(); current = new AbortController();
  const signal = current.signal; root.replaceChildren(); report('Connecting to extension…');
  try {
    const route = parseRoute(location.hash);
    const available = await connections();
    if (signal.aborted) return;
    if (route.page === 'chooser') await chooser(available, signal); else await detail(route, available, signal);
  } catch (error) {
    if (signal.aborted) return;
    report(error instanceof Error ? error.message : 'Dashboard request failed.');
    if (!root.childElementCount) root.append(element('h1', 'Workspaces'), element('p', 'Open Settings to check extension access, or reload this page after updating the extension.', 'empty'));
  }
}
window.addEventListener('hashchange', () => void render());
void render();

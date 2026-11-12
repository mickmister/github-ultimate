import { bridgeRequest } from './client';
import type { HostedConnection } from '../src/hosted-protocol';
import { WorkspaceReader, documents, documentText, type Snapshot, type Workspace } from './workspaces';
import { loadNavigation, saveNavigation, forgetNavigation, type Navigation } from './navigation';
import './style.css';

declare const __HOSTED_BUILD__: { branch: string; sha: string };
document.getElementById('origin')!.textContent = location.origin;
document.getElementById('build')!.textContent = `Branch: ${__HOSTED_BUILD__.branch} · source ${__HOSTED_BUILD__.sha.slice(0, 12)}`;
const status = document.getElementById('status')!;
const result = document.getElementById('result')!;
const select = document.getElementById('connection') as HTMLSelectElement;
const listButton = document.getElementById('repositories') as HTMLButtonElement;
const readButton = document.getElementById('read') as HTMLButtonElement;
const connectButton = document.getElementById('connect') as HTMLButtonElement;
const repository = document.getElementById('repository') as HTMLInputElement;
const workspaceSelect = document.getElementById('workspace') as HTMLSelectElement;
const documentSelect = document.getElementById('document') as HTMLSelectElement;
const scanButton = document.getElementById('scan') as HTMLButtonElement;
const documentsButton = document.getElementById('open-documents') as HTMLButtonElement;
const beadsButton = document.getElementById('inspect-beads') as HTMLButtonElement;
const documentButton = document.getElementById('open-document') as HTMLButtonElement;
const content = document.getElementById('document-content')!;
const snapshotInfo = document.getElementById('snapshot-info')!;
const beadsInfo = document.getElementById('beads-info')!;
const workspaceStatus = document.getElementById('workspace-status')!;
const rememberedInfo = document.getElementById('remembered-info')!;
let saved = loadNavigation();
if (saved) repository.value = saved.repository;
let workspaces: Workspace[] = [];
let snapshot: Snapshot | undefined;
let reader: WorkspaceReader | undefined;
let connections: HostedConnection[] = [];
let generation = 0;
let busy = false;
function report(message: string) { status.textContent = workspaceStatus.textContent = message; }
function remember(discovered = workspaces.length > 0) {
  const connection = connections.find(connection => connection.id === select.value);
  if (!connection?.installation || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository.value.trim())) return;
  saved = { connectionId: connection.id, installationId: connection.installation.id, repository: repository.value.trim(), workspace: workspaceSelect.value || undefined, discovered };
  rememberedInfo.textContent = saveNavigation(saved) ? 'Connection, repository and workspace selections are saved in this browser for this preview.' : 'Browser storage is unavailable. Selections will last for this visit only.';
}
function update() {
  const connection = connections.find(c => c.id === select.value);
  select.disabled = busy || !connections.length;
  listButton.disabled = readButton.disabled = busy || !connection;
  connectButton.disabled = busy;
  repository.disabled = busy;
  scanButton.disabled = busy || !connection;
  workspaceSelect.disabled = busy || !workspaces.length;
  const workspace = workspaces.find(workspace => workspace.name === workspaceSelect.value);
  documentsButton.disabled = busy || !workspace?.documents;
  beadsButton.disabled = busy || !workspace?.dolt;
  documentSelect.disabled = busy || !snapshot;
  documentButton.disabled = busy || !snapshot || !documentSelect.value;
  document.getElementById('connection-info')!.textContent = connection ? `${connection.user?.login ?? 'GitHub user'} · App ${connection.appId} · installation ${connection.installation?.account ?? 'not selected'}` : '';
}
async function action(work: () => Promise<void>) {
  if (busy) return;
  const current = generation;
  busy = true; update(); report('Waiting for extension…');
  try { await work(); }
  catch (error) { if (current === generation) { result.textContent = 'No successful result.'; resetWorkspaces(); report(error instanceof Error ? error.message : 'Request failed.'); } }
  finally { busy = false; update(); }
}
async function connect() {
  const current = generation, restore = saved;
  result.textContent = 'No request yet.'; resetWorkspaces();
  connections = []; select.replaceChildren();
  await bridgeRequest({ operation: 'discover' }, 5000);
  const available = await bridgeRequest<HostedConnection[]>({ operation: 'connections' });
  if (current !== generation) return;
  connections = available;
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a connection'; select.append(placeholder);
  for (const connection of connections) {
    const option = document.createElement('option'); option.value = connection.id;
    option.textContent = `${connection.name} — ${connection.installation?.account ?? connection.user?.login ?? 'GitHub'}`;
    select.append(option);
  }
  if (!connections.length) { const option = document.createElement('option'); option.textContent = 'No approved, signed-in connections'; select.append(option); }
  const previous = restore && connections.find(connection => connection.id === restore.connectionId);
  if (restore && !previous) { report('Connected, but the saved connection is unavailable or no longer approved. Choose a connection explicitly.'); return; }
  const selected = previous ?? (connections.length === 1 ? connections[0] : undefined);
  if (selected) select.value = selected.id;
  if (!restore && selected) remember(false);
  report(connections.length ? `Connected. ${connections.length} approved connection(s). ${selected ? 'Ready to discover workspaces.' : 'Choose one before reading.'}` : 'No usable connections. Sign in, select an installation and approve this origin in extension settings.');
  if (restore && previous?.installation?.id !== restore.installationId) { report('Connected, but the saved installation changed. Discover workspaces explicitly to use the new installation.'); return; }
  if (restore?.discovered && selected) {
    report('Connected. Restoring your workspace selection…');
    await discoverWorkspaces(current, restore);
    if (current === generation && workspaceSelect.value) await openDocuments(current);
  }
}
connectButton.addEventListener('click', () => void action(connect));
select.addEventListener('change', () => { generation++; result.textContent = 'No request yet.'; resetWorkspaces(); remember(false); report('Connection selected. Discover workspaces to browse its storage.'); update(); });
for (const [button, operation] of [[listButton, 'repositories'], [readButton, 'probe']] as const) {
  button.addEventListener('click', () => void action(async () => {
    const current = generation;
    result.textContent = 'Reading…';
    const value = await bridgeRequest(operation === 'probe' ? { operation, id: select.value, repository: (document.getElementById('repository') as HTMLInputElement).value.trim() } : { operation, id: select.value });
    if (current !== generation) return;
    result.textContent = JSON.stringify(value, null, 2);
    report('Read succeeded. Data is displayed only in this tab.');
  }));
}
function clearSnapshot() {
  snapshot = undefined; documentSelect.replaceChildren(); content.textContent = 'No document selected.';
  snapshotInfo.textContent = ''; beadsInfo.textContent = 'Beads issue queries require the hosted Dolt reader, which is not available yet.';
}
function resetWorkspaces() {
  reader = undefined; workspaces = []; workspaceSelect.replaceChildren(); clearSnapshot();
}
repository.addEventListener('input', () => { generation++; resetWorkspaces(); result.textContent = 'No request yet.'; remember(false); update(); });
workspaceSelect.addEventListener('change', () => { generation++; clearSnapshot(); remember(); update(); });
documentSelect.addEventListener('change', () => { generation++; content.textContent = 'No document selected.'; update(); });
function option(select: HTMLSelectElement, value: string, label: string) {
  const element = document.createElement('option'); element.value = value; element.textContent = label; select.append(element);
}
async function discoverWorkspaces(current = generation, restore?: Navigation) {
  resetWorkspaces(); report('Checking extension support for workspace discovery…');
  const capabilities = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' }, 5000);
  if (current !== generation) return;
  if (!Array.isArray(capabilities.capabilities) || !['gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'implicitWorkspaces'].every(capability => capabilities.capabilities.includes(capability))) throw new Error('Workspace discovery needs a newer extension. Update it and reload this page.');
  const connection = connections.find(connection => connection.id === select.value)!;
  const candidate = new WorkspaceReader(bridgeRequest, connection.id, repository.value.trim(), connection.installation!.id);
  const found = await candidate.discover(prefix => { if (current === generation) report(`Discovering workspaces: reading ${prefix} refs through the extension…`); });
  if (current !== generation) return;
  reader = candidate; workspaces = found;
  option(workspaceSelect, '', 'Choose a workspace');
  for (const workspace of found) option(workspaceSelect, workspace.name, `${workspace.name} — ${[workspace.documents && 'documents', workspace.dolt && 'Dolt'].filter(Boolean).join(' + ')}${workspace.documents ? '' : ' (missing manifest ref)'}`);
  if (restore?.workspace && found.some(workspace => workspace.name === restore.workspace)) workspaceSelect.value = restore.workspace;
  remember(true);
  report(restore?.workspace && !workspaceSelect.value ? 'The previous workspace is no longer present in this repository. Choose another workspace.' : found.length ? `${found.length} stored workspace namespace(s). Choose one; its manifest must be verified before opening.` : 'No document or Dolt workspace refs found in this repository.');
}
scanButton.addEventListener('click', () => void action(() => discoverWorkspaces()));
function workspaceReader() {
  const connection = connections.find(connection => connection.id === select.value)!;
  // The approved installation that discovered the namespace is its access
  // route. No separate workspace binding or cross-connection retry is needed.
  return new WorkspaceReader(bridgeRequest, connection.id, repository.value.trim(), connection.installation!.id, workspaceSelect.value);
}
async function openDocuments(current = generation) {
  const workspace = workspaces.find(workspace => workspace.name === workspaceSelect.value)!;
  clearSnapshot(); report('Opening workspace: verifying its manifest and loading documents…');
  const activeReader = workspaceReader();
  const opened = await activeReader.open(workspace); if (current !== generation) return;
  const loaded = opened.snapshot;
  reader = activeReader;
  snapshot = loaded;
  option(documentSelect, '', 'Choose a document');
  for (const entry of documents(loaded)) option(documentSelect, entry.sha + ':' + entry.path, `${entry.path.slice('documents/'.length)} (${entry.size ?? '?'} bytes)`);
  snapshotInfo.textContent = `${opened.manifest.purpose ?? `${opened.manifest.repositories?.length ?? 0} repository attachment(s)`} · Manifest verified. Documents pinned to Git ${loaded.commit}. ${documents(loaded).length} regular document(s).`;
  remember(); report('Document list loaded. Select a document to read its verified contents.');
}
documentsButton.addEventListener('click', () => void action(() => openDocuments()));
documentButton.addEventListener('click', () => void action(async () => {
  const current = generation;
  const entry = documents(snapshot!).find(entry => entry.sha + ':' + entry.path === documentSelect.value)!;
  content.textContent = 'Reading…';
  const bytes = await reader!.blob(entry); if (current !== generation) return;
  content.textContent = documentText(bytes);
  report(`Read verified: ${entry.path.slice('documents/'.length)} · Git blob ${entry.sha}.`);
}));
beadsButton.addEventListener('click', () => void action(async () => {
  const workspace = workspaces.find(workspace => workspace.name === workspaceSelect.value)!;
  const current = generation, activeReader = workspaceReader();
  const opened = await activeReader.open(workspace); if (current !== generation) return;
  snapshotInfo.textContent = `${opened.manifest.purpose ?? `${opened.manifest.repositories?.length ?? 0} repository attachment(s)`} · Manifest verified at Git ${opened.snapshot.commit}.`;
  const connection = connections.find(connection => connection.id === select.value)!;
  const doltReader = new WorkspaceReader(bridgeRequest, connection.id, repository.value.trim(), connection.installation!.id, workspace.name, 'dolt');
  const loaded = await doltReader.snapshot(workspace.dolt!, true);
  const manifest = loaded.tree.tree.find(entry => entry.path === 'manifest');
  if (!manifest) throw new Error('Dolt snapshot has no manifest.');
  const text = documentText(await doltReader.blob(manifest)); if (current !== generation) return;
  const fields = text.split(':');
  if (fields[0] !== '5' || fields[1] !== '__DOLT__' || !/^[0-9a-v]{32}$/.test(fields[3] ?? '')) throw new Error('Unsupported Dolt manifest format.');
  const files = loaded.tree.tree.filter(entry => entry.type === 'blob');
  beadsInfo.textContent = `Dolt storage verified at Git ${loaded.commit}. Manifest storage root ${fields[3]}. ${files.length} files, ${files.filter(entry => entry.path.endsWith('.darc')).length} archives, ${files.reduce((sum, entry) => sum + (entry.size ?? 0), 0).toLocaleString()} bytes. Only the manifest bytes were fetched and verified. Issue queries are not available yet.`;
  remember(); report('Beads storage snapshot inspected; no issue query has run.');
}));
document.getElementById('clear')!.addEventListener('click', () => { generation++; resetWorkspaces(); update(); result.textContent = 'Displayed data cleared.'; report('Displayed data cleared. Saved selections are retained.'); });
document.getElementById('forget')!.addEventListener('click', () => {
  generation++; forgetNavigation(); saved = undefined; resetWorkspaces(); select.value = ''; repository.value = '';
  result.textContent = 'Displayed data cleared.'; rememberedInfo.textContent = ''; report('Saved selections forgotten and displayed data cleared.'); update();
});
void action(connect);

import { bridgeRequest } from './client';
import type { HostedConnection } from '../src/hosted-protocol';
import { WorkspaceReader, documents, documentText, type Snapshot, type Workspace } from './workspaces';
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
let workspaces: Workspace[] = [];
let snapshot: Snapshot | undefined;
let reader: WorkspaceReader | undefined;
let connections: HostedConnection[] = [];
let generation = 0;
let busy = false;
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
  busy = true; update(); status.textContent = 'Waiting for extension…';
  try { await work(); }
  catch (error) { result.textContent = 'No successful result.'; resetWorkspaces(); status.textContent = error instanceof Error ? error.message : 'Request failed.'; }
  finally { busy = false; update(); }
}
connectButton.addEventListener('click', () => void action(async () => {
  generation++; result.textContent = 'No request yet.'; resetWorkspaces();
  connections = []; select.replaceChildren();
  await bridgeRequest({ operation: 'discover' }, 5000);
  connections = await bridgeRequest<HostedConnection[]>({ operation: 'connections' });
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a connection'; select.append(placeholder);
  for (const connection of connections) {
    const option = document.createElement('option'); option.value = connection.id;
    option.textContent = `${connection.name} — ${connection.installation?.account ?? connection.user?.login ?? 'GitHub'}`;
    select.append(option);
  }
  if (!connections.length) { const option = document.createElement('option'); option.textContent = 'No approved, signed-in connections'; select.append(option); }
  status.textContent = connections.length ? `Connected. ${connections.length} approved connection(s). Choose one before reading.` : 'No usable connections. Sign in, select an installation and approve this origin in extension settings.';
}));
select.addEventListener('change', () => { generation++; result.textContent = 'No request yet.'; resetWorkspaces(); update(); });
for (const [button, operation] of [[listButton, 'repositories'], [readButton, 'probe']] as const) {
  button.addEventListener('click', () => void action(async () => {
    const current = generation;
    result.textContent = 'Reading…';
    const value = await bridgeRequest(operation === 'probe' ? { operation, id: select.value, repository: (document.getElementById('repository') as HTMLInputElement).value.trim() } : { operation, id: select.value });
    if (current !== generation) return;
    result.textContent = JSON.stringify(value, null, 2);
    status.textContent = 'Read succeeded. Data is displayed only in this tab.';
  }));
}
function clearSnapshot() {
  snapshot = undefined; documentSelect.replaceChildren(); content.textContent = 'No document selected.';
  snapshotInfo.textContent = ''; beadsInfo.textContent = 'Beads issue queries require the hosted Dolt reader, which is not available yet.';
}
function resetWorkspaces() {
  reader = undefined; workspaces = []; workspaceSelect.replaceChildren(); clearSnapshot();
}
repository.addEventListener('input', () => { generation++; resetWorkspaces(); result.textContent = 'No request yet.'; update(); });
workspaceSelect.addEventListener('change', () => { generation++; clearSnapshot(); update(); });
documentSelect.addEventListener('change', () => { generation++; content.textContent = 'No document selected.'; update(); });
function option(select: HTMLSelectElement, value: string, label: string) {
  const element = document.createElement('option'); element.value = value; element.textContent = label; select.append(element);
}
scanButton.addEventListener('click', () => void action(async () => {
  resetWorkspaces(); const current = generation;
  const capabilities = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' });
  if (!['gitRefs', 'gitCommit', 'gitTree', 'gitBlob'].every(capability => capabilities.capabilities.includes(capability))) throw new Error('Update the extension to enable workspace reads, then reload this page.');
  const candidate = new WorkspaceReader(bridgeRequest, select.value, repository.value.trim());
  const found = await candidate.discover(); if (current !== generation) return;
  reader = candidate; workspaces = found;
  option(workspaceSelect, '', 'Choose a workspace');
  for (const workspace of found) option(workspaceSelect, workspace.name, `${workspace.name} — ${[workspace.documents && 'documents', workspace.dolt && 'Dolt'].filter(Boolean).join(' + ')}`);
  status.textContent = found.length ? `${found.length} stored workspace namespace(s). Choose one to browse.` : 'No document or Dolt workspace refs found in this repository.';
}));
documentsButton.addEventListener('click', () => void action(async () => {
  const workspace = workspaces.find(workspace => workspace.name === workspaceSelect.value)!;
  const current = generation; clearSnapshot();
  const loaded = await reader!.snapshot(workspace.documents!); if (current !== generation) return;
  snapshot = loaded;
  option(documentSelect, '', 'Choose a document');
  for (const entry of documents(loaded)) option(documentSelect, entry.sha + ':' + entry.path, `${entry.path.slice('documents/'.length)} (${entry.size ?? '?'} bytes)`);
  snapshotInfo.textContent = `Documents pinned to Git ${loaded.commit}. ${documents(loaded).length} regular document(s).`;
  status.textContent = 'Document list loaded. Select a document to read its verified contents.';
}));
documentButton.addEventListener('click', () => void action(async () => {
  const current = generation;
  const entry = documents(snapshot!).find(entry => entry.sha + ':' + entry.path === documentSelect.value)!;
  content.textContent = 'Reading…';
  const bytes = await reader!.blob(entry); if (current !== generation) return;
  content.textContent = documentText(bytes);
  status.textContent = `Read verified: ${entry.path.slice('documents/'.length)} · Git blob ${entry.sha}.`;
}));
beadsButton.addEventListener('click', () => void action(async () => {
  const workspace = workspaces.find(workspace => workspace.name === workspaceSelect.value)!;
  const current = generation, activeReader = reader!;
  const loaded = await activeReader.snapshot(workspace.dolt!);
  const manifest = loaded.tree.tree.find(entry => entry.path === 'manifest');
  if (!manifest) throw new Error('Dolt snapshot has no manifest.');
  const text = documentText(await activeReader.blob(manifest)); if (current !== generation) return;
  const fields = text.split(':');
  if (fields[0] !== '5' || fields[1] !== '__DOLT__' || !/^[0-9a-v]{32}$/.test(fields[3] ?? '')) throw new Error('Unsupported Dolt manifest format.');
  const files = loaded.tree.tree.filter(entry => entry.type === 'blob');
  beadsInfo.textContent = `Dolt storage verified at Git ${loaded.commit}. Manifest storage root ${fields[3]}. ${files.length} files, ${files.filter(entry => entry.path.endsWith('.darc')).length} archives, ${files.reduce((sum, entry) => sum + (entry.size ?? 0), 0).toLocaleString()} bytes. Only the manifest bytes were fetched and verified. Issue queries are not available yet.`;
  status.textContent = 'Beads storage snapshot inspected; no issue query has run.';
}));
document.getElementById('clear')!.addEventListener('click', () => { generation++; resetWorkspaces(); update(); result.textContent = 'Displayed data cleared.'; status.textContent = 'Displayed data cleared.'; });

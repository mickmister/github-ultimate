import { defaultClient, type ConnectionRequest, type PublicConnection, type Installation, type Repository } from './connections';
import { extensionAPI } from './extension-api';

const status = document.getElementById('status')!;
const container = document.getElementById('connections')!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
field('name').value = defaultClient.name;
field('appId').value = String(defaultClient.appId);
field('clientId').value = defaultClient.clientId;

async function request<T>(value: ConnectionRequest): Promise<T> {
  const response = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-connections-v1', request: value });
  if (!response?.ok) throw new Error(response?.error ?? 'The background broker is unavailable. Reload the extension and this page.');
  return response.result;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(parent: HTMLElement, text: string, action: () => Promise<void>) {
  const control = element('button', text);
  control.type = 'button';
  control.addEventListener('click', async () => {
    control.disabled = true; status.textContent = '';
    try { await action(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'Connection operation failed.'; }
    finally { control.disabled = false; }
  });
  parent.append(control);
}
let records: PublicConnection[] = [];
const paused = new Set<string>();
async function reload() { records = await request({ operation: 'list' }); render(); }
function render() {
  container.replaceChildren();
  for (const record of records) {
    const card = element('article');
    card.setAttribute('aria-label', record.name);
    card.append(element('h2', record.name), element('p', `App ${record.appId} · ${record.clientId}`));
    if (record.connected) {
      card.append(element('p', `Signed in${record.user ? ` as ${record.user.login}` : ''}. Access token expires ${new Date(record.expiresAt!).toLocaleString()}.`));
      button(card, 'Refresh credentials', async () => { await request({ operation: 'refresh', id: record.id }); await reload(); status.textContent = 'Credentials refreshed and saved. Use Read repository to verify the new token.'; });
      const installationArea = element('section');
      button(card, 'Load installations', async () => {
        const installations = await request<Installation[]>({ operation: 'installations', id: record.id });
        installationArea.replaceChildren();
        if (!installations.length) installationArea.append(element('p', 'No installations for this App are accessible to this user. Install the client App, then reload installations.'));
        for (const installation of installations) {
          const row = element('div');
          row.append(element('p', `${installation.account.login} · installation ${installation.id} · ${JSON.stringify(installation.permissions)}`));
          button(row, `Use ${installation.account.login}`, async () => { await request({ operation: 'selectInstallation', id: record.id, installationId: installation.id }); await reload(); });
          installationArea.append(row);
        }
      });
      card.append(installationArea);
      if (record.installation) {
        card.append(element('p', `Selected installation: ${record.installation.account} (${record.installation.id})`));
        const output = element('pre');
        output.setAttribute('aria-label', 'Read results');
        button(card, 'List repositories', async () => {
          const repositories = await request<Repository[]>({ operation: 'repositories', id: record.id });
          output.textContent = repositories.map(r => `${r.full_name} (${r.private ? 'private' : 'public'})`).join('\n') || 'No repositories available.';
        });
        const label = element('label', 'Repository to read');
        const repository = element('input');
        repository.value = 'mickmister/workspace-storage';
        repository.autocomplete = 'off'; label.append(repository); card.append(label);
        button(card, 'Read repository', async () => {
          const result = await request({ operation: 'probe', id: record.id, repository: repository.value.trim() });
          output.textContent = JSON.stringify(result, null, 2);
          status.textContent = 'Repository read succeeded using this connection. This checks the default-branch Git ref, not raw Dolt data yet.';
        });
        card.append(output);
      }
    } else if (record.pending) {
      card.append(element('p', `Enter code ${record.pending.userCode} on GitHub. Expires ${new Date(record.pending.expiresAt).toLocaleTimeString()}.`));
      const link = element('a', 'Open GitHub device authorization');
      link.href = 'https://github.com/login/device'; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
      card.append(element('small', paused.has(record.id) ? 'Automatic checks paused after an error. Check sign-in to retry.' : 'Waiting for authorization. You may switch to GitHub; keep this settings tab open.'));
      button(card, 'Check sign-in', async () => { paused.delete(record.id); await request({ operation: 'poll', id: record.id }); await reload(); });
    } else {
      button(card, 'Sign in with device code', async () => { paused.delete(record.id); await request({ operation: 'start', id: record.id }); await reload(); });
    }
    button(card, 'Disconnect locally', async () => { paused.delete(record.id); await request({ operation: 'disconnect', id: record.id }); await reload(); status.textContent = 'Local credentials removed. GitHub authorization has not been revoked.'; });
    button(card, 'Remove connection', async () => { paused.delete(record.id); await request({ operation: 'remove', id: record.id }); await reload(); status.textContent = 'Connection and its local credentials removed.'; });
    container.append(card);
  }
  if (!records.length) container.append(element('p', 'No connections yet. Add your client App above.'));
}
document.getElementById('add')!.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = document.querySelector<HTMLButtonElement>('#add button')!;
  submit.disabled = true;
  try {
    await request({ operation: 'add', name: field('name').value.trim(), appId: Number(field('appId').value), clientId: field('clientId').value.trim() });
    await reload(); status.textContent = 'Connection added. Start device sign-in below.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not add connection.'; }
  finally { submit.disabled = false; }
});
async function poll() {
  try {
    for (const record of records.filter(r => r.pending && !paused.has(r.id) && r.pending.nextPollAt <= Date.now())) {
      try { await request({ operation: 'poll', id: record.id }); }
      catch (error) { paused.add(record.id); status.textContent = error instanceof Error ? error.message : 'Sign-in check failed.'; }
      await reload();
    }
  } finally { setTimeout(() => void poll(), 2000); }
}
void reload().then(() => poll()).catch(error => { status.textContent = error instanceof Error ? error.message : 'Could not load connections.'; });

import type { ConnectionRequest, PublicConnection, Installation, Repository } from './connections';
import { extensionAPI } from './extension-api';
import { trustedOrigin, originPattern } from './hosted-protocol';
import { trustedSubpath, type HostedGrant } from './hosted-access';
import './s3-settings-page';

const status = document.getElementById('status')!;
const container = document.getElementById('connections')!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

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
        const recent = record.recentNavigation.at(-1);
        if (recent) {
          const resume = element('a', `Resume ${recent.navigation.workspace} · ${recent.navigation.repository}`);
          resume.href = recent.source; resume.target = '_blank'; resume.rel = 'noopener noreferrer'; card.append(resume);
        }
        const output = element('pre');
        output.setAttribute('aria-label', 'Read results');
        button(card, 'List repositories', async () => {
          const repositories = await request<Repository[]>({ operation: 'repositories', id: record.id });
          output.textContent = repositories.map(r => `${r.full_name} (${r.private ? 'private' : 'public'})`).join('\n') || 'No repositories available.';
        });
        const label = element('label', 'Repository to read');
        const repository = element('input');
        repository.placeholder = 'owner/repository';
        try { repository.value = localStorage.getItem(`connection-repository:${record.id}`) ?? recent?.navigation.repository ?? ''; } catch { repository.value = recent?.navigation.repository ?? ''; }
        repository.addEventListener('change', () => { try { localStorage.setItem(`connection-repository:${record.id}`, repository.value.trim()); } catch { /* Optional preference storage. */ } });
        repository.autocomplete = 'off'; label.append(repository); card.append(label);
        button(card, 'Read repository', async () => {
          const result = await request({ operation: 'probe', id: record.id, repository: repository.value.trim() });
          output.textContent = JSON.stringify(result, null, 2);
          status.textContent = 'Repository read succeeded using this connection. This checks the default-branch Git ref, not raw Dolt data yet.';
        });
        card.append(output);
        const originLabel = element('label', 'Hosted origin to approve');
        const originInput = element('input'); originInput.placeholder = 'https://your-app.example'; originLabel.append(originInput); card.append(originLabel);
        const subpathLabel = element('label', 'Hosted subpath');
        const subpathInput = element('input'); subpathInput.value = '/'; subpathLabel.append(subpathInput); card.append(subpathLabel);
        const lastGrant = record.hostedGrants.at(-1);
        if (lastGrant) { originInput.value = lastGrant.origin; subpathInput.value = lastGrant.subpath; }
        let replacing: HostedGrant | undefined;
        card.append(element('small', 'Approve the original loaded document directory and its descendants. / covers all paths on the origin. Browser host permission is broader; these rows control connection access. Reload after first approval. Workflow dispatch is not granted.'));
        button(card, 'Grant hosted read access', async () => {
          const origin = trustedOrigin(originInput.value.trim());
          const subpath = trustedSubpath(subpathInput.value);
          // Must be the first asynchronous call after the user gesture.
          if (!await extensionAPI().permissions.request({ origins: [originPattern(origin)] })) throw new Error('Browser host access was declined.');
          await request({ operation: 'grantOrigin', id: record.id, origin, subpath, replace: replacing });
          await reload(); status.textContent = 'Hosted read access granted. Reload the hosted page, then connect.';
        });
        for (const grant of record.hostedGrants) {
          const { origin, subpath } = grant;
          const row = element('p', `Hosted reads approved: ${origin}${subpath}${subpath === '/' ? ' (all paths)' : ' (directory and descendants)'}`);
          button(row, `Edit ${origin}${subpath}`, async () => { replacing = grant; originInput.value = origin; subpathInput.value = subpath; originInput.focus(); status.textContent = 'Edit the pair, then Grant hosted read access to replace it.'; });
          button(row, `Revoke ${origin}${subpath}`, async () => { await request({ operation: 'revokeOrigin', id: record.id, origin, subpath }); await reload(); status.textContent = 'Hosted access revoked for this connection.'; });
          card.append(row);
        }
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

import { extensionAPI } from './extension-api';
import { originPattern, trustedOrigin } from './hosted-protocol';
import { trustedSubpath, type HostedGrant } from './hosted-access';
import { s3BucketURL, s3ConfigurationSchema, type PublicS3Connection, type S3SettingsRequest } from './s3-protocol';

const form = document.getElementById('s3-add') as HTMLFormElement;
const container = document.getElementById('s3-connections')!;
const status = document.getElementById('s3-status')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
let editing: string | undefined;
async function request<T>(request: S3SettingsRequest): Promise<T> {
  const response = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-s3-settings-v1', request });
  if (!response?.ok) throw new Error(response?.error ?? 'S3 broker unavailable. Reload the extension.');
  return response.result;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
function button(parent: HTMLElement, text: string, action: () => Promise<void>) {
  const node = element('button', text); node.type = 'button'; parent.append(node);
  node.addEventListener('click', async () => {
    node.disabled = true; status.textContent = '';
    try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : 'S3 settings failed.'; }
    finally { node.disabled = false; }
  });
}
async function reload() {
  const records = await request<PublicS3Connection[]>({ operation: 'list' });
  container.replaceChildren();
  for (const record of records) {
    const card = element('article'); card.setAttribute('aria-label', record.name);
    card.append(element('h3', record.name), element('p', `${record.endpoint} · ${record.bucket} · ${record.prefix || '(whole bucket)'} · ${record.region} · ${record.addressing} style`));
    card.append(element('p', `Read/list: ${record.allowRead ? 'enabled' : 'disabled'} · Upload: ${record.allowUpload ? 'enabled' : 'disabled'} · Replacement: ${record.allowOverwrite ? 'allowed' : 'not allowed'}`));
    button(card, 'Edit S3 connection', async () => {
      editing = record.id;
      for (const name of ['name', 'endpoint', 'bucket', 'region', 'prefix', 'addressing'] as const) field(name).value = record[name];
      for (const name of ['allowRead', 'allowUpload', 'allowOverwrite'] as const) field(name).checked = record[name];
      for (const name of ['accessKeyId', 'secretAccessKey', 'sessionToken']) field(name).value = '';
      field('name').focus(); status.textContent = 'Editing this connection. Re-enter credentials to save or rotate them; hosted grants are retained.';
    });
    const originLabel = element('label', 'S3 hosted origin'), origin = element('input'); origin.placeholder = 'https://your-app.example'; originLabel.append(origin);
    const pathLabel = element('label', 'S3 hosted subpath'), path = element('input'); path.value = '/'; pathLabel.append(path);
    card.append(originLabel, pathLabel);
    let replacing: HostedGrant | undefined;
    button(card, 'Grant hosted S3 access', async () => {
      const source = trustedOrigin(origin.value.trim()), subpath = trustedSubpath(path.value);
      if (!await extensionAPI().permissions.request({ origins: [originPattern(source)] })) throw new Error('Browser host access was declined.');
      await request({ operation: 'grantOrigin', id: record.id, origin: source, subpath, replace: replacing });
      await reload(); status.textContent = 'S3 origin/subpath grant saved. Reload the hosted page after first approval.';
    });
    for (const grant of record.hostedGrants) {
      const row = element('p', `${grant.origin}${grant.subpath}`);
      button(row, `Edit S3 grant ${grant.origin}${grant.subpath}`, async () => { replacing = grant; origin.value = grant.origin; path.value = grant.subpath; origin.focus(); });
      button(row, `Revoke S3 grant ${grant.origin}${grant.subpath}`, async () => { await request({ operation: 'revokeOrigin', id: record.id, ...grant }); await reload(); status.textContent = 'S3 access revoked for this pair.'; });
      card.append(row);
    }
    button(card, 'Remove S3 connection', async () => { await request({ operation: 'remove', id: record.id }); await reload(); status.textContent = 'S3 connection and local credentials removed.'; });
    container.append(card);
  }
  if (!records.length) container.append(element('p', 'No S3 connections yet. Add your endpoint, bucket and credentials above.'));
}
form.addEventListener('submit', async event => {
  event.preventDefault(); const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true;
  try {
    const config = s3ConfigurationSchema.parse({ ...Object.fromEntries(new FormData(form)), allowRead: field('allowRead').checked, allowUpload: field('allowUpload').checked, allowOverwrite: field('allowOverwrite').checked });
    const origin = s3BucketURL(config).origin;
    if (!await extensionAPI().permissions.request({ origins: [originPattern(origin)] })) throw new Error('Browser host access to the S3 endpoint was declined.');
    await request(editing ? { operation: 'update', id: editing, ...config } : { operation: 'add', ...config });
    editing = undefined; form.reset(); await reload(); status.textContent = 'S3 connection saved. Approve hosted origin/subpath pairs below.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'S3 connection could not be saved.'; }
  finally { submit.disabled = false; }
});
form.addEventListener('reset', () => { editing = undefined; });
void reload().catch(() => { status.textContent = 'S3 broker unavailable. Update or reload the extension.'; });

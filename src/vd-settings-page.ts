import { extensionAPI } from './extension-api';
import { originPattern } from './hosted-protocol';
import { vdDraftSchema, type PublicVdConnection, type VdDraft, type VdSettingsRequest } from './vd-protocol';

const form = document.getElementById('vd-add') as HTMLFormElement;
const container = document.getElementById('vd-connections')!;
const notice = document.getElementById('vd-status')!;
const rows = document.getElementById('vd-headers')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
let editing: string | undefined, headers: VdDraft['headers'] = [], busy = false;
async function request<T>(request: VdSettingsRequest): Promise<T> {
  const result = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-vd-settings-v1', request });
  if (!result?.ok) throw new Error(result?.error ?? 'VD broker unavailable.');
  return result.result;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; }
function button(parent: HTMLElement, label: string, action: () => Promise<void> | void) {
  const result = node('button', label); result.type = 'button'; parent.append(result);
  result.addEventListener('click', () => { void run(action); }); return result;
}
async function run(action: () => Promise<void> | void) {
  if (busy) return; busy = true; notice.textContent = '';
  for (const element of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#vd-section input, #vd-section button, #vd-section select')) element.disabled = true;
   try { await action(); } catch (error) { notice.textContent = error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid VD settings. Check the origin and headers.'; }
  finally {
    busy = false;
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#vd-section input, #vd-section button, #vd-section select')) element.disabled = false;
  }
}
function renderHeaders() {
  rows.replaceChildren();
  headers.forEach((header, index) => {
    const row = node('fieldset'), nameLabel = node('label', 'Header name'), name = node('input'); name.value = header.name; nameLabel.append(name);
    name.addEventListener('input', () => { header.name = name.value; });
    const modeLabel = node('label', 'Header mode'), mode = node('select');
    for (const value of ['secret', 'plaintext']) { const option = node('option', value); option.value = value; mode.append(option); }
    mode.value = header.mode; modeLabel.append(mode);
    const valueLabel = node('label', 'Replacement value (unchanged saved secret may be left untouched)'), value = node('input');
    value.autocomplete = 'off'; value.type = header.mode === 'secret' ? 'password' : 'text'; value.value = header.value ?? ''; valueLabel.append(value);
    value.addEventListener('input', () => { header.value = value.value; });
    mode.addEventListener('change', () => { header.mode = mode.value as 'secret' | 'plaintext'; header.value = ''; renderHeaders(); });
    row.append(nameLabel, modeLabel, valueLabel); button(row, 'Remove header', () => { headers.splice(index, 1); renderHeaders(); }); rows.append(row);
  });
}
function input() { return { id: editing, name: field('name').value, origin: field('origin').value, headers: structuredClone(headers) }; }
function draft() { return vdDraftSchema.parse(input()); }
function reset() { editing = undefined; headers = []; renderHeaders(); form.reset(); }
async function reload() {
  const records = await request<PublicVdConnection[]>({ operation: 'list' }); container.replaceChildren();
  for (const record of records) {
    const card = node('article'); card.setAttribute('aria-label', record.name);
    card.append(node('h3', record.name), node('p', `${record.origin} · All accessible workspaces`));
    for (const header of record.headers) card.append(node('p', `${header.name}: ${header.mode === 'secret' ? (header.configured ? 'Secret configured' : 'Empty secret') : header.value}`));
    button(card, 'Edit VD connection', () => {
      editing = record.id;
      for (const key of ['name', 'origin'] as const) field(key).value = record[key];
      headers = record.headers.map(header => ({ name: header.name, mode: header.mode, ...(header.mode === 'plaintext' ? { value: header.value } : {}) })); renderHeaders();
      notice.textContent = 'Leave saved secrets untouched to retain them. A changed origin requires replacement header values.';
    });
    const originLabel = node('label', 'VD hosted origin'), origin = node('input'); origin.placeholder = 'https://your-app.example'; originLabel.append(origin);
    const pathLabel = node('label', 'VD hosted subpath'), path = node('input'); path.value = '/'; pathLabel.append(path); card.append(originLabel, pathLabel);
    button(card, 'Grant hosted VK continuation', async () => {
      if (!await extensionAPI().permissions.request({ origins: [originPattern(origin.value.trim())] })) throw new Error('Browser access was declined.');
      await request({ operation: 'grantOrigin', id: record.id, origin: origin.value.trim(), subpath: path.value }); await reload(); notice.textContent = 'VK continuation grant saved. Reload the hosted page after first approval.';
    });
    for (const grant of record.hostedGrants) {
      const line = node('p', grant.origin + grant.subpath);
      button(line, 'Revoke VD grant', async () => { await request({ operation: 'revokeOrigin', id: record.id, ...grant }); await reload(); }); card.append(line);
    }
    button(card, 'Remove VD connection', async () => { await request({ operation: 'remove', id: record.id }); await reload(); }); container.append(card);
  }
  if (!records.length) container.append(node('p', 'No VD connections configured.'));
}
button(document.getElementById('vd-header-actions')!, 'Add VD header', () => { headers.push({ name: '', mode: 'secret', value: '' }); renderHeaders(); });
button(document.getElementById('vd-actions')!, 'Test VD connection', async () => {
  const value = draft();
  if (!await extensionAPI().permissions.request({ origins: [originPattern(value.origin)] })) throw new Error('VD host access was declined.');
  notice.textContent = (await request<{ message: string }>({ operation: 'test', draft: value })).message;
});
button(document.getElementById('vd-actions')!, 'Cancel VD edit', reset);
form.addEventListener('submit', event => {
  event.preventDefault(); void run(async () => {
    const submitted = input();
    // Discard submitted secret inputs even if permission/storage fails.
    headers = headers.map(header => header.mode === 'secret' ? { name: header.name, mode: header.mode } : header); renderHeaders();
    const value = vdDraftSchema.parse(submitted);
    if (!await extensionAPI().permissions.request({ origins: [originPattern(value.origin)] })) throw new Error('VD host access was declined.');
    await request({ operation: 'save', draft: value }); reset(); await reload(); notice.textContent = 'VD connection saved. Approve a hosted continuation grant below.';
  });
});
void reload().catch(() => { notice.textContent = 'VD settings unavailable. Update or reload the extension.'; });

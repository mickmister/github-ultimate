import { extensionAPI } from './extension-api';
import { originPattern, trustedOrigin } from './hosted-protocol';
import { inferenceURL, type PublicInferenceConnection } from './inference-protocol';
import { element } from '../hosted/components';

const form = document.querySelector<HTMLFormElement>('#inference-add')!;
const status = document.querySelector<HTMLElement>('#inference-status')!;
const container = document.querySelector<HTMLElement>('#inference-connections')!;
async function request<T>(request: unknown): Promise<T> {
  const response = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-inference-settings-v1', request });
  if (!response?.ok) throw new Error(response?.error ?? 'Inference broker unavailable.');
  return response.result;
}
function button(parent: HTMLElement, text: string, work: () => Promise<void>) {
  const control = element('button', text); control.type = 'button';
  control.addEventListener('click', async () => {
    control.disabled = true;
    try { await work(); } catch (error) { status.textContent = error instanceof Error ? error.message : 'Inference settings failed.'; }
    finally { control.disabled = false; }
  });
  parent.append(control);
}
async function reload() {
  const records = await request<PublicInferenceConnection[]>({ operation: 'list' });
  container.replaceChildren();
  for (const record of records) {
    const card = element('article'); card.setAttribute('aria-label', record.name);
    card.append(element('h3', record.name), element('p', record.model));
    const origin = element('input'), subpath = element('input'); subpath.value = '/';
    const originLabel = element('label', 'Inference hosted origin'), pathLabel = element('label', 'Inference hosted subpath');
    originLabel.append(origin); pathLabel.append(subpath); card.append(originLabel, pathLabel);
    button(card, 'Grant inference access', async () => {
      const approved = trustedOrigin(origin.value.trim());
      if (!await extensionAPI().permissions.request({ origins: [originPattern(approved)] })) throw new Error('Browser access declined.');
      await request({ operation: 'grantOrigin', id: record.id, origin: approved, subpath: subpath.value });
      await reload(); status.textContent = 'Inference access granted. Reload the hosted page.';
    });
    for (const grant of record.hostedGrants) {
      const row = element('p', `${grant.origin}${grant.subpath}`);
      button(row, 'Revoke inference access', async () => { await request({ operation: 'revokeOrigin', id: record.id, ...grant }); await reload(); });
      card.append(row);
    }
    button(card, 'Remove inference connection', async () => { await request({ operation: 'remove', id: record.id }); await reload(); });
    container.append(card);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form), submit = form.querySelector('button')!; submit.disabled = true;
  try {
    const url = inferenceURL(String(data.get('url')).trim());
    // Permission must be requested directly from the user gesture.
    if (!await extensionAPI().permissions.request({ origins: [originPattern(url.origin)] })) throw new Error('Inference endpoint access declined.');
    const headers = JSON.parse(String(data.get('headers') || '{}'));
    if (!headers || Array.isArray(headers) || typeof headers !== 'object' || Object.values(headers).some(value => typeof value !== 'string')) throw new Error('Headers must be a JSON object of string values.');
    await request({ operation: 'add', name: data.get('name'), model: data.get('model'), url: url.href, headers: Object.entries(headers).map(([name, value]) => ({ name, value })) });
    form.reset(); await reload(); status.textContent = 'Inference connection saved. Approve the hosted app path below.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Inference settings failed.'; }
  finally { submit.disabled = false; }
});
void reload().catch(() => { status.textContent = 'Inference settings unavailable. Reload the extension.'; });

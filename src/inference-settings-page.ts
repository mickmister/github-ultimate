import { extensionAPI } from './extension-api';
import { originPattern, trustedOrigin } from './hosted-protocol';
import { inferenceURL, type PublicInferenceConnection } from './inference-protocol';
import { element } from '../hosted/components';
import { CHATGPT_ORIGINS, type ChatGPTSignIn } from './chatgpt-auth';

const form = document.querySelector<HTMLFormElement>('#inference-add')!;
const status = document.querySelector<HTMLElement>('#inference-status')!;
const container = document.querySelector<HTMLElement>('#inference-connections')!;
const chatgptForm = document.querySelector<HTMLFormElement>('#chatgpt-connect')!;
const polls = new Map<string, ReturnType<typeof setTimeout>>();
let generation = 0;
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
  const current = ++generation;
  for (const timer of polls.values()) clearTimeout(timer);
  polls.clear();
  const records = await request<PublicInferenceConnection[]>({ operation: 'list' });
  if (current !== generation) return;
  container.replaceChildren();
  for (const record of records) {
    const card = element('article'); card.setAttribute('aria-label', record.name);
    card.append(element('h3', record.name), element('p', record.model));
    if (record.provider === 'chatgpt') {
      card.append(element('p', `ChatGPT · ${record.authStatus ?? 'disconnected'}`));
      const signIn = element('div'); signIn.setAttribute('aria-live', 'polite'); card.append(signIn);
      const poll = async () => {
        if (current !== generation) return;
        try {
          const pending = await request<ChatGPTSignIn>({ operation: 'chatgptPoll', id: record.id });
          if (current !== generation) return;
          if (!pending) { if (record.authStatus === 'connecting') { await reload(); status.textContent = 'ChatGPT connected. Approve the hosted app path below.'; } return; }
          showCode(pending);
        } catch (error) { signIn.textContent = error instanceof Error ? error.message : 'ChatGPT sign-in failed. Connect again.'; }
      };
      const showCode = (pending: NonNullable<ChatGPTSignIn>) => {
        signIn.replaceChildren(element('p', 'Enter this code on the ChatGPT verification page:'), element('code', pending.userCode));
        const link = element('a', 'Open ChatGPT verification'); link.href = pending.verificationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; signIn.append(link);
        polls.set(record.id, setTimeout(() => { void poll(); }, Math.max(1000, pending.pollAfterMs)));
      };
      button(card, record.authStatus === 'connected' ? 'Reconnect ChatGPT' : 'Sign in to ChatGPT', async () => {
        if (!await extensionAPI().permissions.request({ origins: CHATGPT_ORIGINS.map(originPattern) })) throw new Error('ChatGPT browser access declined.');
        await request({ operation: 'chatgptStart', id: record.id }); await reload();
      });
      if (record.authStatus === 'connecting') {
        void poll();
        button(card, 'Cancel ChatGPT sign-in', async () => { await request({ operation: 'chatgptCancel', id: record.id }); await reload(); });
      }
      if (record.authStatus === 'connected') button(card, 'Disconnect ChatGPT', async () => {
        await request({ operation: 'chatgptDisconnect', id: record.id }); await reload(); status.textContent = 'ChatGPT disconnected locally. Manage remote sessions in ChatGPT security settings.';
      });
      const modelLabel = element('label', 'ChatGPT model'), model = element('input'); model.value = record.model; model.maxLength = 200; modelLabel.append(model); card.append(modelLabel);
      button(card, 'Save ChatGPT model', async () => { await request({ operation: 'chatgptModel', id: record.id, model: model.value }); await reload(); status.textContent = 'ChatGPT model saved. Reload the hosted page.'; });
    }
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
chatgptForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(chatgptForm), submit = chatgptForm.querySelector('button')!; submit.disabled = true;
  try {
    if (!await extensionAPI().permissions.request({ origins: CHATGPT_ORIGINS.map(originPattern) })) throw new Error('ChatGPT browser access declined.');
    const record = await request<PublicInferenceConnection>({ operation: 'chatgptAdd', name: data.get('name'), model: data.get('model') });
    await request({ operation: 'chatgptStart', id: record.id }); await reload(); status.textContent = 'Complete ChatGPT sign-in using the code below.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'ChatGPT sign-in failed.'; await reload(); }
  finally { submit.disabled = false; }
});
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

import { cacheSettingFields, cacheSettingsSchema, defaultCacheSettings, type CacheSettings } from './cache-settings';
import { extensionAPI } from './extension-api';
import type { ConnectionRequest } from './connections';

const form = document.getElementById('workspace-cache-settings') as HTMLFormElement;
if (form) {
  const status = document.getElementById('workspace-cache-status')!;
  let current = defaultCacheSettings();
  const fields = cacheSettingFields.map(field => {
    const label = document.createElement('label'); label.textContent = field.label;
    const input = document.createElement('input'); input.type = 'number'; input.required = true; input.min = String(field.min); input.max = String(field.max); input.step = '1';
    label.append(input); form.insertBefore(label, form.querySelector('button')); return { ...field, input };
  });
  const dolt = form.elements.namedItem('cacheDolt') as HTMLInputElement;
  async function send(request: ConnectionRequest) {
    const reply = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-connections-v1', request });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Cache broker unavailable.');
    const result = reply.result as { settings: CacheSettings; status: { bytes: number; error: string } };
    current = result.settings; dolt.checked = current.cacheDolt;
    for (const field of fields) field.input.value = String(current[field.key]);
    status.textContent = `${(result.status.bytes / 1048576).toFixed(1)} MiB cached. Read-through cache; full snapshots are not yet prefetched. ${result.status.error}`;
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const button = form.querySelector('button')!; button.disabled = true;
    void Promise.resolve().then(async () => {
      const settings = cacheSettingsSchema.parse({ ...current, cacheDolt: dolt.checked, ...Object.fromEntries(fields.map(field => [field.key, Number(field.input.value)])) });
      await send({ operation: 'saveCacheSettings', settings });
    }).catch(() => { status.textContent = 'Cache settings could not be saved. Check limits and storage availability.'; }).finally(() => { button.disabled = false; });
  });
  void send({ operation: 'cacheSettings' }).catch(() => { status.textContent = 'Persistent cache settings unavailable.'; });
}

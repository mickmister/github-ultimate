import { settings, write } from './storage';
async function main() {
  const current = await settings();
  for (const key of ['enabled', 'inlineForms', 'rememberDrafts'] as const) {
    const input = document.getElementById(key) as HTMLInputElement;
    input.checked = current[key];
    input.addEventListener('change', async () => {
      current[key] = input.checked;
      await write('settings', current);
      document.getElementById('status')!.textContent = 'Saved. Open PR views update automatically.';
    });
  }
  document.getElementById('clear')!.addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(key => key.startsWith('draft:')));
    document.getElementById('status')!.textContent = 'Saved drafts cleared.';
  });
}
void main();

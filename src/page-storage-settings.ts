import { extensionAPI } from './extension-api';
import { originPattern, trustedOrigin } from './hosted-protocol';
import { trustedSubpath, type HostedGrant } from './hosted-access';

const root = document.getElementById('page-storage-grants')!;
const status = document.getElementById('page-storage-status')!;
async function request(value: object): Promise<HostedGrant[]> {
  const reply = await extensionAPI().runtime.sendMessage({ channel: 'github-ultimate-page-storage-settings-v1', request: value });
  if (!reply?.ok) throw new Error(reply?.error ?? 'Page storage settings unavailable.');
  return reply.result;
}
function render(grants: HostedGrant[]) {
  root.replaceChildren();
  for (const grant of grants) {
    const row = document.createElement('p'); row.textContent = `${grant.origin}${grant.subpath} `;
    const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = `Revoke page storage ${grant.origin}${grant.subpath}`;
    revoke.onclick = () => { void request({ operation: 'revoke', ...grant }).then(render).catch(error => { status.textContent = String(error); }); };
    row.append(revoke); root.append(row);
  }
}
document.getElementById('page-storage-add')!.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    const origin = trustedOrigin((document.getElementById('page-storage-origin') as HTMLInputElement).value);
    const subpath = trustedSubpath((document.getElementById('page-storage-subpath') as HTMLInputElement).value);
    if (!await extensionAPI().permissions.request({ origins: [originPattern(origin)] })) throw new Error('Browser host permission declined.');
    render(await request({ operation: 'grant', origin, subpath }));
    status.textContent = 'Page storage approved. Reload the hosted document before connecting.';
  })().catch(error => { status.textContent = String(error); });
});
void request({ operation: 'list' }).then(render).catch(error => { status.textContent = String(error); });

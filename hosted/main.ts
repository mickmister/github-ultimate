import { bridgeRequest } from './client';
import type { HostedConnection } from '../src/hosted-protocol';
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
let connections: HostedConnection[] = [];
let generation = 0;
let busy = false;
function update() {
  const connection = connections.find(c => c.id === select.value);
  select.disabled = busy || !connections.length;
  listButton.disabled = readButton.disabled = busy || !connection;
  connectButton.disabled = busy;
  document.getElementById('connection-info')!.textContent = connection ? `${connection.user?.login ?? 'GitHub user'} · App ${connection.appId} · installation ${connection.installation?.account ?? 'not selected'}` : '';
}
async function action(work: () => Promise<void>) {
  if (busy) return;
  busy = true; update(); status.textContent = 'Waiting for extension…';
  try { await work(); }
  catch (error) { result.textContent = 'No successful result.'; status.textContent = error instanceof Error ? error.message : 'Request failed.'; }
  finally { busy = false; update(); }
}
connectButton.addEventListener('click', () => void action(async () => {
  generation++; result.textContent = 'No request yet.';
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
select.addEventListener('change', () => { generation++; result.textContent = 'No request yet.'; update(); });
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
document.getElementById('clear')!.addEventListener('click', () => { generation++; result.textContent = 'Displayed data cleared.'; status.textContent = 'Displayed data cleared.'; });

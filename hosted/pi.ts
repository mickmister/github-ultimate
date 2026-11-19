import { bridgeRequest } from './client';
import { browserPiAgent } from './pi-agent';
import { PiSessions, type SessionBinding } from './pi-session';
import type { HostedConnection } from '../src/hosted-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection, S3Listing } from '../src/s3-protocol';
import './dashboard.css';

const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const session = document.getElementById('session') as HTMLInputElement;
const status = document.getElementById('pi-status')!;
const transcript = document.getElementById('transcript')!;
let inferences: PublicInferenceConnection[] = [], githubs: HostedConnection[] = [], stores: PublicS3Connection[] = [];
let runtime: ReturnType<typeof browserPiAgent> | undefined, sessions: PiSessions | undefined, binding: SessionBinding | undefined;
let parent: string | null = null, dirty = false, busy = false, token: string | undefined;
function report(value: string) { status.textContent = value; }
function options(id: string, records: { id: string; name: string }[]) {
  select(id).replaceChildren(new Option('Choose a connection', ''), ...records.map(record => new Option(record.name, record.id)));
}
function render() {
  transcript.textContent = (runtime?.agent.state.messages ?? []).filter(message => message.role !== 'system').map(message => `${message.role}: ${typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? part.text : JSON.stringify(part)).join('\n')}${message.role === 'assistant' && message.errorMessage ? `\n${message.errorMessage}` : ''}`).join('\n\n');
}
function controls() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#setup input, #setup select, #setup button, #connect').forEach(control => { control.disabled = busy || dirty; });
  button('send').disabled = busy || dirty || !runtime;
  button('stop').disabled = !busy;
  button('retry-save').hidden = !dirty;
}
function configure() {
  const inference = inferences.find(record => record.id === select('inference').value), github = githubs.find(record => record.id === select('github').value), storage = stores.find(record => record.id === select('storage').value);
  if (!inference || !github?.installation || !github.user || !storage || !storage.allowRead || !storage.allowUpload || storage.allowOverwrite) throw new Error('Choose inference, signed-in GitHub and S3 connections. S3 needs reads/uploads enabled and overwrites disabled.');
  binding = { runtime: 'earendil-pi-1.5.2-text-v1', inferenceModel: inference.model, githubAppId: github.appId, githubUserId: github.user.id, installationId: github.installation.id, storageEndpoint: new URL(storage.endpoint).href, storageBucket: storage.bucket, storagePrefix: storage.prefix, storageRegion: storage.region, storageAddressing: storage.addressing };
  sessions = new PiSessions(bridgeRequest, storage);
  return { inference, github, storage };
}
function start(messages: Parameters<typeof browserPiAgent>[3] = []) {
  const { inference, github } = configure(); sessions!.prefix(session.value);
  runtime = browserPiAgent(bridgeRequest, inference, github, messages);
  runtime.agent.subscribe(() => render()); render(); controls();
}
async function save() {
  try {
    parent = await sessions!.save(session.value, binding!, runtime!.agent.state.messages, parent);
    dirty = false; report(`Saved and readback-verified: ${parent}`);
  } catch (error) { dirty = true; throw error; }
  finally { controls(); }
}
function action(id: string, work: () => Promise<void>) {
  button(id).addEventListener('click', async () => { try { busy = true; controls(); await work(); } catch (error) { report(error instanceof Error ? error.message : 'Operation failed.'); } finally { busy = false; controls(); } });
}
action('connect', async () => {
  [inferences, githubs, stores] = await Promise.all([bridgeRequest<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }), bridgeRequest<HostedConnection[]>({ operation: 'connections' }), bridgeRequest<PublicS3Connection[]>({ operation: 's3Connections' })]);
  options('inference', inferences); options('github', githubs); options('storage', stores); runtime = undefined;
  report('Choose all three connections, then create or restore a session.');
});
for (const id of ['inference', 'github', 'storage', 'session']) document.getElementById(id)!.addEventListener('change', () => { runtime = undefined; parent = null; token = undefined; select('checkpoint').replaceChildren(); button('more-checkpoints').hidden = true; render(); controls(); });
action('new-session', async () => { session.value = crypto.randomUUID(); parent = null; start(); await save(); });
async function list(more = false) {
  const { storage } = configure();
  if (!more) { token = undefined; select('checkpoint').replaceChildren(); }
  const listing = await bridgeRequest<S3Listing>({ operation: 's3List', id: storage.id, revision: storage.revision, prefix: sessions!.prefix(session.value), continuationToken: token });
  for (const object of listing.objects.filter(object => object.key.endsWith('.json'))) select('checkpoint').append(new Option(object.key, object.key));
  token = listing.continuationToken; button('more-checkpoints').hidden = !token;
  report('Select an exact checkpoint to restore. Separate tabs create separate branches, not a shared mutable head.');
}
action('list-checkpoints', () => list()); action('more-checkpoints', () => list(true));
action('restore', async () => { configure(); const key = select('checkpoint').value; const checkpoint = await sessions!.read(key, session.value, binding!); start(checkpoint.messages); parent = key; report(`Restored ${key}. No tools were replayed.`); });
action('retry-save', save);
button('stop').addEventListener('click', () => { runtime?.agent.abort(); report('Stopping inference. Completed read-only tool results will be saved.'); });
document.getElementById('prompt-form')!.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || dirty || !runtime) return;
  busy = true; controls(); report('Agent running…');
  try {
    runtime.resetBudget(); const prompt = document.getElementById('prompt') as HTMLTextAreaElement;
    const pending = runtime.agent.prompt(prompt.value); dirty = true; prompt.value = '';
    await pending; render(); await save();
  } catch (error) { report(error instanceof Error ? error.message : 'Agent run failed.'); }
  finally { busy = false; controls(); }
});
window.addEventListener('beforeunload', event => { if (busy || dirty) event.preventDefault(); });

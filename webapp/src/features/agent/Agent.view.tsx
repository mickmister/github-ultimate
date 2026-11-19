import type { BrowserAgent, AgentFields } from '../../../../hosted/browser-agent';
import { copy } from './Agent.copy';
export interface AgentProps {
  model: Pick<BrowserAgent, 'fields' | 'inferences' | 'githubs' | 'stores' | 'checkpoints' | 'token' | 'busy' | 'dirty' | 'runtime' | 'scratch' | 'error' | 'status' | 'output' | 'transcript'>; documentsHref: string;
  actions: { edit(key: keyof AgentFields, value: string): void; connect(): void; create(imported: boolean): void; list(more: boolean): void; restore(): void; save(): void; prompt(): void; script(): void; commit(): void; stop(): void };
}
export function AgentHeader(p: AgentProps) { return <header className="page-header"><h1>{copy.title}</h1><a href={p.documentsHref}>{copy.documents}</a></header>; }
export function AgentSetup({ model: m, actions: a }: AgentProps) {
  const locked = m.busy || m.dirty;
  return <section aria-label={copy.setup}><fieldset disabled={locked} className="agent-fields"><button onClick={a.connect}>{copy.connect}</button>
    {(['inference', 'github', 'storage'] as const).map(key => <label key={key}>{copy[key]}<select aria-label={copy[key]} value={m.fields[key]} onChange={event => a.edit(key, event.target.value)}><option value="">{copy.choose}</option>{(key === 'inference' ? m.inferences : key === 'github' ? m.githubs : m.stores).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}
    {(['repository', 'commit', 'directory'] as const).map(key => <label key={key}>{copy[key]}<input value={m.fields[key]} onChange={event => a.edit(key, event.target.value)} /></label>)}
    <button onClick={() => a.create(false)}>{copy.empty}</button><button disabled={!m.fields.repository || !m.fields.commit} onClick={() => a.create(true)}>{copy.import}</button>
    <label>{copy.session}<input value={m.fields.session} onChange={event => a.edit('session', event.target.value)} /></label><button disabled={!m.fields.session} onClick={() => a.list(false)}>{copy.list}</button>
    {m.token && <button onClick={() => a.list(true)}>{copy.more}</button>}
    <label>{copy.checkpoint}<select aria-label={copy.checkpoint} value={m.fields.checkpoint} onChange={event => a.edit('checkpoint', event.target.value)}><option value="">{copy.selectCheckpoint}</option>{m.checkpoints.map(key => <option key={key}>{key}</option>)}</select></label><button disabled={!m.fields.checkpoint} onClick={a.restore}>{copy.restore}</button>
  </fieldset>{m.dirty && <button disabled={m.busy} onClick={a.save}>{copy.retry}</button>}</section>;
}
export function AgentConversation({ model: m, actions: a }: AgentProps) {
  return <section className="agent-conversation" aria-label={copy.conversation}><h2>{copy.conversation}</h2><pre className="agent-transcript">{m.transcript()}</pre>
    <form onSubmit={event => { event.preventDefault(); a.prompt(); }}><label>{copy.prompt}<textarea aria-label={copy.prompt} rows={5} value={m.fields.prompt} disabled={m.busy || m.dirty} onChange={event => a.edit('prompt', event.target.value)} /></label><button disabled={m.busy || m.dirty || !m.runtime || !m.fields.prompt.trim()}>{copy.send}</button><button type="button" disabled={!m.busy} onClick={a.stop}>{copy.stop}</button></form>
    {m.busy && <p role="status">{copy.running}</p>}{m.error && <p role="alert">{m.error}</p>}{m.status && <p role="status" className="agent-status">{m.status}</p>}
  </section>;
}
export function AgentScratch({ model: m, actions: a }: AgentProps) {
  const locked = m.busy || m.dirty || !m.scratch;
  return <section className="agent-scratch" aria-label={copy.scratch}><h2>{copy.scratch}</h2><p>{copy.scope}</p>
    <output>{m.scratch?.head}</output><ul aria-label={copy.files}>{m.scratch?.list().map(file => <li key={file.path}><code>{file.path}</code><span>{file.bytes}</span></li>)}</ul>
    <h3>{copy.diff}</h3><pre>{m.scratch?.diff().map(f => f.patch).join('\n')}</pre>
    <fieldset disabled={locked}><label>{copy.script}<textarea aria-label={copy.script} rows={7} value={m.fields.script} onChange={event => a.edit('script', event.target.value)} spellCheck={false} /></label><button disabled={!m.fields.script.trim()} onClick={a.script}>{copy.run}</button>
    <label>{copy.message}<input value={m.fields.message} onChange={event => a.edit('message', event.target.value)} /></label><button disabled={!m.fields.message.trim() || !m.scratch?.diff().length} onClick={a.commit}>{copy.commitScratch}</button></fieldset><pre>{m.output}</pre>
    <h3>{copy.history}</h3><ol>{m.scratch?.snapshot().commits.slice().reverse().map(c => <li key={c.oid}><code>{c.oid}</code><pre>{c.body.split('\n\n').slice(1).join('\n\n')}</pre></li>)}</ol>
  </section>;
}

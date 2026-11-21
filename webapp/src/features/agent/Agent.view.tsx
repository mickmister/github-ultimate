import type { BrowserAgent, AgentFields } from '../../../../hosted/browser-agent';
import { copy } from './Agent.copy';
import type { RemoteSessions, LiveSessionReader } from '../../../../hosted/live-session';
export type RemoteSessionView = Omit<Pick<RemoteSessions, 'scope' | 'stores' | 'storage' | 'root' | 'selected' | 'locators' | 'reader' | 'busy' | 'following' | 'error'>, 'reader'> & { reader?: Pick<LiveSessionReader, 'sequence' | 'transcript' | 'lastObserved' | 'settled' | 'terminal' | 'tools' | 'sessions'> };
export interface AgentProps {
  remote?: { model: RemoteSessionView; href: string; actions: { edit(key: 'storage' | 'root' | 'selected', value: string): void; connect(): void; discover(): void; follow(): void; pause(): void } };
  model: Pick<BrowserAgent, 'fields' | 'inferences' | 'githubs' | 'stores' | 'checkpoints' | 'token' | 'busy' | 'dirty' | 'runtime' | 'scratch' | 'error' | 'status' | 'output' | 'transcript'>; documentsHref: string;
  actions: { edit(key: keyof AgentFields, value: string): void; connect(): void; create(imported: boolean): void; list(more: boolean): void; restore(): void; save(): void; prompt(): void; script(): void; commit(): void; diff(): void; stop(): void };
}
export function AgentHeader(p: AgentProps) { return <header className="page-header"><h1>{copy.title}</h1><a href={p.documentsHref}>{copy.documents}</a></header>; }
export function AgentRemote({ remote }: AgentProps) {
  if (!remote?.model.scope) return null;
  const { model: m, actions: a } = remote, reader = m.reader;
  const current = m.locators.find(row => row.key === m.selected)?.value;
  return <section className="agent-remote" aria-label={copy.remoteTitle}><h2>{copy.remoteTitle}</h2>
    <fieldset disabled={m.busy || m.following} className="agent-remote-fields"><button onClick={a.connect}>{copy.remoteConnect}</button>
      <label>{copy.remoteStorage}<select aria-label={copy.remoteStorage} value={m.storage} onChange={event => a.edit('storage', event.target.value)}><option value="">{copy.choose}</option>{m.stores.filter(s => s.allowRead).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>{copy.remoteRoot}<input value={m.root} onChange={event => a.edit('root', event.target.value)} /></label><button disabled={!m.storage} onClick={a.discover}>{copy.remoteDiscover}</button>
      <label>{copy.remoteSession}<select aria-label={copy.remoteSession} value={m.selected} onChange={event => a.edit('selected', event.target.value)}><option value="">{copy.remoteChoose}</option>{m.locators.map(row => <option key={row.key} value={row.key}>{row.value.executionId}{copy.remoteSeparator}{row.value.command}{copy.remoteSeparator}{row.value.binding.process}</option>)}</select></label>
    </fieldset>
    <button disabled={!current || m.busy || m.following || reader?.settled} onClick={a.follow}>{copy.remoteFollow}</button><button disabled={!m.following} onClick={a.pause}>{copy.remotePause}</button>
    {m.selected && <a href={remote.href}>{copy.remoteLink}</a>}
    {current && <a href={`https://github.com/${current.repository}/actions/runs/${current.executionId.split('-')[0]}/attempts/${current.executionId.split('-')[1]}`} target="_blank" rel="noreferrer">{copy.remoteRun}</a>}
    <p role="status">{reader?.settled ? reader.terminal?.status === 'completed' ? copy.remoteCompleted : copy.remoteFailed : m.following ? copy.remoteFollowing : copy.remotePaused}</p>
    {reader?.lastObserved && <p>{copy.remoteObserved} <time dateTime={reader.lastObserved}>{reader.lastObserved}</time>{!reader.settled && <>{copy.remoteSeparator}{copy.remoteUnknown}</>}</p>}
    {m.error && <p role="alert">{m.error}</p>}
    <div className="agent-remote-transcript" aria-label={copy.remoteTranscript}>{reader?.transcript.map(message => <article key={message.id}><strong>{message.role}</strong>{message.partial && <small>{copy.remoteSeparator}{copy.remotePartial}</small>}<pre>{message.text}</pre></article>)}</div>
    {!!reader?.tools.size && <section aria-label={copy.remoteTools}><h3>{copy.remoteTools}</h3><ul>{[...reader.tools.values()].map(tool => <li key={tool.id}><strong>{tool.name}</strong>{copy.remoteSeparator}{tool.state}<pre>{tool.detail}</pre></li>)}</ul></section>}
    {reader && <details><summary>{copy.remoteProvenance}</summary><output>{reader.sequence}</output><ul>{[...reader.sessions].map(([id, session]) => <li key={id}><code>{id}</code>{copy.remoteSeparator}{session.role}{session.parentId && <>{copy.remoteParent}<code>{session.parentId}</code></>}</li>)}</ul></details>}
  </section>;
}
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
    <h3>{copy.diff}</h3><button disabled={locked} onClick={a.diff}>{copy.loadDiff}</button><pre>{m.scratch?.diff().map(f => f.patch).join('\n')}</pre>
    <fieldset disabled={locked}><label>{copy.script}<textarea aria-label={copy.script} rows={7} value={m.fields.script} onChange={event => a.edit('script', event.target.value)} spellCheck={false} /></label><button disabled={!m.fields.script.trim()} onClick={a.script}>{copy.run}</button>
    <label>{copy.message}<input value={m.fields.message} onChange={event => a.edit('message', event.target.value)} /></label><button disabled={!m.fields.message.trim() || !m.scratch?.diff().length} onClick={a.commit}>{copy.commitScratch}</button></fieldset><pre>{m.output}</pre>
    <h3>{copy.history}</h3><ol>{m.scratch?.snapshot().commits.slice().reverse().map(c => <li key={c.oid}><code>{c.oid}</code><pre>{c.body.split('\n\n').slice(1).join('\n\n')}</pre></li>)}</ol>
  </section>;
}

'use client';
import type { ChatModel } from './Chat.hooks';
import type { AgentMessage } from '@/lib/types';
import { MessageView } from '@/components/MessageView';

function Connections({ model: m }: { model: ChatModel }) {
  return <details className="chat-connections" open={!m.snapshot.sessionId}><summary>Connections</summary><div className="chat-controls">
    <button disabled={m.busy} onClick={() => void m.connect()}>Connect</button>
    <label>Inference<select aria-label="Inference connection" disabled={m.busy || Boolean(m.snapshot.sessionId)} value={m.inferenceId} onChange={e => m.setInferenceId(e.target.value)}><option value="">Choose inference</option>{m.inference.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
    <label>S3 storage<select aria-label="S3 storage" disabled={m.busy || m.snapshot.dirty} value={m.storageId} onChange={e => m.chooseStorage(e.target.value)}><option value="">Choose storage</option>{m.storage.map(item => <option key={item.id} value={item.id}>{item.name} · {item.bucket}</option>)}</select></label>
  </div></details>;
}
function Library({ model: m }: { model: ChatModel }) {
  return <nav className="chat-library" aria-label="Saved conversations"><h2>Saved conversations</h2>
    <button disabled={m.busy || !m.selectedStorage || m.snapshot.dirty} onClick={() => void m.list()}>Refresh conversations</button>
    {!m.chats.length && <p>No saved checkpoints loaded.</p>}
    <ul>{m.chats.map(item => <li key={item.reference}><button disabled={m.busy || m.snapshot.dirty} aria-current={m.snapshot.reference === item.reference ? 'page' : undefined} onClick={() => void m.open(item)}>{item.label}</button></li>)}</ul>
    {m.token && <button disabled={m.busy} onClick={() => void m.list(true)}>Load more checkpoints</button>}
    <p className="chat-help">Checkpoints preserve each continuation. Older workspace-agent checkpoints use the Agent screen.</p>
  </nav>;
}
function Conversation({ model: m }: { model: ChatModel }) {
  return <section className="chat-conversation" aria-label="Conversation"><header><h1>{m.snapshot.title}</h1><p role="status">{m.busy ? m.snapshot.dirty ? 'Saving…' : 'Working…' : m.snapshot.dirty ? 'Not saved' : m.snapshot.reference ? 'Saved to S3' : 'Connect inference and S3 to begin.'}</p></header>
    {m.error && <p role="alert">{m.error}</p>}
    {m.snapshot.dirty && !m.busy && <button onClick={() => void m.retrySave()}>Retry session save</button>}
    {m.snapshot.phase === 'interrupted' && <aside><p>The previous turn was interrupted. It has not been resent.</p><button disabled={m.busy || m.snapshot.dirty} onClick={() => void m.send(true)}>Continue interrupted turn</button></aside>}
    <div className="chat-transcript" role="log" aria-label="Messages">{m.snapshot.messages.map((message, index) => <MessageView key={index} message={message as unknown as AgentMessage} showTimestamp sessionId={m.snapshot.sessionId} />)}
      {!m.snapshot.messages.length && <p>Start a conversation. Messages are saved to your selected S3 storage.</p>}</div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void m.send(); }}>
      <textarea aria-label="Message" value={m.draft} onChange={e => m.setDraft(e.target.value)} placeholder="Message Pi" rows={3} disabled={!m.snapshot.sessionId} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void m.send(); } }} />
      {m.busy ? <button type="button" onClick={m.stop}>Stop</button> : <button disabled={!m.snapshot.sessionId || m.snapshot.dirty || m.snapshot.phase !== 'idle' || !m.draft.trim()}>Send</button>}
    </form>
  </section>;
}
function Header({ model: m }: { model: ChatModel }) {
  return <div className="chat-toolbar"><button disabled={m.busy || m.snapshot.dirty || !m.selectedInference || !m.selectedStorage} onClick={() => void m.create()}>New conversation</button><button disabled={m.busy} onClick={() => m.setShowList(!m.showList)}>Conversations</button>{m.snapshot.sessionId && <><button disabled={m.busy || m.snapshot.dirty && Boolean(m.snapshot.messages.length)} onClick={m.close}>Close conversation</button><button disabled={!m.snapshot.reference || m.snapshot.dirty} onClick={() => void m.copyLink()}>Copy conversation link</button></>}<Connections model={m} /></div>;
}
export function PhoneChat({ model }: { model: ChatModel }) { return <main className="chat-app chat-phone"><Header model={model} />{model.showList ? <Library model={model} /> : <Conversation model={model} />}</main>; }
export function TabletChat({ model }: { model: ChatModel }) { return <main className="chat-app chat-tablet"><Header model={model} /><div className="chat-columns">{model.showList && <Library model={model} />}<Conversation model={model} /></div></main>; }
export function DesktopChat({ model }: { model: ChatModel }) { return <main className="chat-app chat-desktop"><Header model={model} /><div className="chat-columns"><Library model={model} /><Conversation model={model} /></div></main>; }

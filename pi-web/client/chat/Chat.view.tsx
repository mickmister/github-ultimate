'use client';
import type { ChatModel } from './Chat.hooks';
import type { AgentMessage, ToolResultMessage } from '@/lib/types';
import { MessageView } from '@/components/MessageView';
import { ThemeIcon } from '@/components/ThemeIcon';
import { SessionSidebar as Library } from './SessionSidebar.view';

function Connections({ model: m }: { model: ChatModel }) {
  return <details className="chat-connections" open={!m.snapshot.sessionId}><summary>Connections</summary><div className="chat-controls">
    <button disabled={m.busy} onClick={() => void m.connect()}>Connect</button>
    <label>Inference<select aria-label="Inference connection" disabled={m.busy || Boolean(m.snapshot.sessionId)} value={m.inferenceId} onChange={e => m.setInferenceId(e.target.value)}><option value="">Choose inference</option>{m.inference.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
    <label>S3 storage<select aria-label="S3 storage" disabled={m.busy || m.snapshot.dirty} value={m.storageId} onChange={e => m.chooseStorage(e.target.value)}><option value="">Choose storage</option>{m.storage.map(item => <option key={item.id} value={item.id}>{item.name} · {item.bucket}</option>)}</select></label>
  </div></details>;
}
export function Transcript({ messages, sessionId, streaming = false }: { messages: AgentMessage[]; sessionId?: string; streaming?: boolean }) {
  const results = new Map(messages.filter((message): message is ToolResultMessage => message.role === 'toolResult').map(message => [message.toolCallId, message]));
  return <div className="chat-transcript-content">{messages.map((message, index) => <MessageView key={index} message={message} toolResults={results} isStreaming={streaming && index === messages.length - 1} showTimestamp sessionId={sessionId} />)}</div>;
}
function Conversation({ model: m }: { model: ChatModel }) {
  return <section className="chat-conversation" aria-label="Conversation"><header><h1>{m.draftMode ? 'New conversation' : m.snapshot.title}</h1><p role="status">{m.busy ? m.snapshot.dirty ? 'Saving…' : 'Working…' : m.snapshot.dirty ? 'Not saved' : m.snapshot.reference ? 'Saved to S3' : m.draftMode ? 'Draft · saved when you send your first message.' : 'Connect inference and S3 to begin.'}</p></header>
    {m.error && <p role="alert">{m.error}</p>}
    {m.snapshot.dirty && !m.busy && <button onClick={() => void m.retrySave()}>Retry session save</button>}
    {m.snapshot.phase === 'interrupted' && <aside><p>The previous turn was interrupted. It has not been resent.</p><button disabled={m.busy || m.snapshot.dirty} onClick={() => void m.send(true)}>Continue interrupted turn</button></aside>}
    <div className="chat-transcript" role="log" aria-label="Messages"><Transcript messages={m.snapshot.messages as AgentMessage[]} sessionId={m.snapshot.sessionId} />
      {!m.snapshot.messages.length && <div className="chat-empty"><h2>What can I help you with?</h2><p>Start a conversation. Messages are saved to your selected S3 storage.</p></div>}</div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void m.send(); }}>
      <textarea aria-label="Message" value={m.draft} onChange={e => m.setDraft(e.target.value)} placeholder="Message Pi" rows={1} disabled={!m.snapshot.sessionId && !m.draftMode} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void m.send(); } }} />
      {m.busy ? <button type="button" onClick={m.stop}>Stop</button> : <button disabled={!m.snapshot.sessionId && !m.draftMode || m.snapshot.dirty || m.snapshot.phase !== 'idle' || !m.draft.trim()}>Send</button>}
    </form>
    <footer className="chat-composer-footer"><span>⚙ {m.selectedInference?.model ?? 'Choose a model'}</span><span>Build {process.env.NEXT_PUBLIC_APP_VERSION ?? 'development'}</span><span>{m.selectedStorage ? `S3 · ${m.selectedStorage.bucket}` : 'Choose storage'}</span></footer>
  </section>;
}
function Header({ model: m }: { model: ChatModel }) {
  return <div className="chat-toolbar">{!m.showList && <><button disabled={m.busy} onClick={() => m.setShowList(true)}>Conversations</button><button disabled={m.busy || m.snapshot.dirty || !m.selectedInference || !m.selectedStorage} onClick={() => void m.create()}>New conversation</button></>}
    <button className="chat-theme-button" aria-label="Toggle light and dark theme" onClick={() => m.theme.setThemePreference(m.theme.isDark ? 'light' : 'dark')}><ThemeIcon preference={m.theme.preference} /></button>
    {(m.snapshot.sessionId || m.draftMode) && <><button disabled={m.busy || m.snapshot.dirty && Boolean(m.snapshot.messages.length)} onClick={m.close}>Close conversation</button><button disabled={!m.snapshot.reference || m.snapshot.dirty} onClick={() => void m.copyLink()}>Copy conversation link</button></>}{!m.showList && <Connections model={m} />}</div>;
}
function Shell({ model, device }: { model: ChatModel; device: string }) { return <main className={`chat-app chat-${device}${model.showList ? ' chat-list-open' : ''}`}><div className="chat-columns">{model.showList && <Library model={model}><Connections model={model} /></Library>}<div className="chat-workspace"><Header model={model} /><Conversation model={model} /></div></div></main>; }
export function PhoneChat({ model }: { model: ChatModel }) { return <Shell model={model} device="phone" />; }
export function TabletChat({ model }: { model: ChatModel }) { return <Shell model={model} device="tablet" />; }
export function DesktopChat({ model }: { model: ChatModel }) { return <Shell model={model} device="desktop" />; }

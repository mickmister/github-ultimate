'use client';
import type { ChatModel } from './Chat.hooks';
import type { AgentMessage, ToolResultMessage } from '@/lib/types';
import { MessageView } from '@/components/MessageView';
import { ThemeIcon } from '@/components/ThemeIcon';
import { SessionSidebar as Library } from './SessionSidebar.view';
import { PreviewSlots } from './PreviewSlots.view';
import { workspaceKey } from './Chat.hooks';
import { ChatIcon } from './ChatIcon.view';
import { displayMessage } from './transcript-adapter';
import type { ChatMessage } from '../../../hosted/pi-chat-contract';
import { ErrorBoundary } from './ErrorBoundary.view';
import { BeadsView, BeadDialogs } from './Beads.view';
import { beadContext } from '../../../src/bead-context';

function Connections({ model: m }: { model: ChatModel }) {
  return <section className="chat-connections" aria-label="Connections"><h3>Connections</h3><div className="chat-controls">
    <button disabled={m.busy} onClick={() => void m.connect()}>Connect</button>
    <label>Inference<select aria-label="Inference connection" disabled={m.busy || Boolean(m.snapshot.sessionId)} value={m.inferenceId} onChange={e => m.setInferenceId(e.target.value)}><option value="">Choose inference</option>{m.inference.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
    <label>S3 storage<select aria-label="S3 storage" disabled={m.busy || m.snapshot.dirty} value={m.storageId} onChange={e => m.chooseStorage(e.target.value)}><option value="">Choose storage</option>{m.storage.map(item => <option key={item.id} value={item.id}>{item.name} · {item.bucket}</option>)}</select></label>
    <button disabled={m.busy || !m.selectedStorage || m.snapshot.dirty} onClick={() => void m.list()}>Load conversations</button>
    {m.snapshot.reference && <label>Move conversation<select aria-label="Move conversation to workspace" value="" disabled={m.busy || m.snapshot.dirty || m.previews.busy} onChange={event => void m.moveWorkspace(event.target.value)}><option value="" disabled>Choose destination</option><option value="unassigned">Unassigned</option>{m.previews.catalog?.workspaces?.map(workspace => <option key={workspaceKey(workspace)} value={workspaceKey(workspace)}>{workspace.workspace} · {workspace.repository}</option>)}</select></label>}
  </div></section>;
}
function Settings({ model: m }: { model: ChatModel }) {
  return <dialog ref={m.settingsDialog} className="chat-settings" aria-labelledby="chat-settings-title" onCancel={m.closeSettings} onClick={event => { if (event.target === event.currentTarget) m.closeSettings(); }}><div className="chat-settings-content"><header><h2 id="chat-settings-title">Settings</h2><button className="chat-icon-button" aria-label="Close settings" title="Close settings" onClick={m.closeSettings}><ChatIcon name="close" /></button></header><Connections model={m} /><div className="chat-settings-theme"><span>Appearance</span><button className="chat-icon-button" aria-label="Toggle light and dark theme" onClick={() => m.theme.setThemePreference(m.theme.isDark ? 'light' : 'dark')}><ThemeIcon preference={m.theme.preference} /></button></div></div></dialog>;
}
export function Transcript({ messages, sessionId, streaming = false }: { messages: AgentMessage[]; sessionId?: string; streaming?: boolean }) {
  const results = new Map(messages.filter((message): message is ToolResultMessage => message.role === 'toolResult').map(message => [message.toolCallId, message]));
  return <div className="chat-transcript-content">{messages.map((message, index) => <ErrorBoundary key={`${sessionId ?? 'draft'}:${index}`} scope="message" retry><MessageView message={message} toolResults={results} isStreaming={streaming && index === messages.length - 1} showTimestamp sessionId={sessionId} /></ErrorBoundary>)}</div>;
}
function RuntimeMessage({ message, results, streaming, sessionId }: { message: ChatMessage; results: Map<string, Extract<ChatMessage, { role: 'toolResult' }>>; streaming: boolean; sessionId?: string }) {
  const toolResults = new Map<string, ToolResultMessage>();
  if (message.role === 'assistant') for (const block of message.content) if (block.type === 'toolCall') {
    const result = results.get(block.id); if (result) toolResults.set(block.id, displayMessage(result));
  }
  const context = message.role === 'user' && typeof message.content === 'string' ? beadContext(message.content) : undefined;
  const shown = context && message.role === 'user' ? { ...message, content: context.text } : message;
  return <>{context && <div className="pi-bead-chips" aria-label="Attached Beads">{context.context.beads.map(bead => <span className="pi-bead-chip" key={bead.id} title={`${context.context.repository} · ${context.context.workspace}`}>{bead.id} · {bead.title}</span>)}</div>}<MessageView message={displayMessage(shown)} toolResults={toolResults} isStreaming={streaming} showTimestamp sessionId={sessionId} /></>;
}
export function CanonicalTranscript({ messages, sessionId, streaming = false }: { messages: ChatMessage[]; sessionId?: string; streaming?: boolean }) {
  const results = new Map(messages.filter(message => message.role === 'toolResult').map(message => [message.toolCallId, message]));
  return <div className="chat-transcript-content">{messages.map((message, index) => <ErrorBoundary key={`${sessionId ?? 'draft'}:${index}`} scope="message" retry><RuntimeMessage message={message} results={results} streaming={streaming && index === messages.length - 1} sessionId={sessionId} /></ErrorBoundary>)}</div>;
}
function Conversation({ model: m }: { model: ChatModel }) {
  return <section className="chat-conversation" aria-label="Conversation"><header><h1>{m.draftMode ? 'New conversation' : m.snapshot.title}</h1><div className="chat-conversation-actions"><p role="status">{m.busy ? m.snapshot.dirty ? 'Saving…' : 'Working…' : m.snapshot.dirty ? 'Not saved' : m.snapshot.reference ? 'Saved to S3' : m.draftMode ? 'Draft · saved when you send your first message.' : 'Connect inference and S3 to begin.'}</p>{(m.snapshot.sessionId || m.draftMode) && <><button className="chat-icon-button" title="Copy conversation link" aria-label="Copy conversation link" disabled={!m.snapshot.reference || m.snapshot.dirty} onClick={() => void m.copyLink()}><ChatIcon name="link" /></button><button className="chat-icon-button" title="Close conversation" aria-label="Close conversation" disabled={m.busy || m.snapshot.dirty && Boolean(m.snapshot.messages.length)} onClick={m.close}><ChatIcon name="close" /></button></>}</div></header>
    {m.error && <p role="alert">{m.error}</p>}
    {m.copiedCount > 0 && <aside aria-label="Copied conversations"><p>{m.copiedCount} copied conversation(s) still name their previous storage. Import preserves their saved messages and workspace associations. No model requests are sent.</p><button disabled={m.busy} onClick={() => void m.importCopied()}>Import copied conversations</button></aside>}
    {m.movedConversation && <button disabled={m.busy} onClick={() => void m.followConversation()}>Open conversation in {m.movedConversation.workspace?.workspace ?? 'Unassigned inbox'}</button>}
    {m.route.kind === 'inbox' && <p>Unassigned migration inbox. Select a saved conversation and move it into a workspace in Settings → Connections to continue.</p>}
    {m.snapshot.dirty && !m.busy && <button onClick={() => void m.retrySave()}>Retry session save</button>}
    {m.snapshot.phase === 'interrupted' && <aside><p>The previous turn was interrupted. It has not been resent.</p><button disabled={m.busy || m.snapshot.dirty} onClick={() => void m.send(true)}>Continue interrupted turn</button></aside>}
    <div className="chat-transcript" role="log" aria-label="Messages"><ErrorBoundary scope="conversation" retry key={m.snapshot.sessionId ?? 'draft'}><CanonicalTranscript messages={m.snapshot.messages} sessionId={m.snapshot.sessionId} streaming={m.snapshot.streaming} /></ErrorBoundary>
      {!m.snapshot.messages.length && <div className="chat-empty"><h2>What can I help you with?</h2><p>Start a conversation. Messages are saved to your selected S3 storage.</p></div>}</div>
    {m.draftBeads.length > 0 && <div className="pi-bead-chips" aria-label="Beads in draft">{m.draftBeads.map(bead => <span className="pi-bead-chip" key={bead.id}>{bead.id} · {bead.title}<button aria-label={`Remove ${bead.id} from message`} onClick={() => m.removeDraftBead(bead.id)}>×</button></span>)}</div>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void m.send(); }}>
      <textarea aria-label="Message" value={m.draft} onChange={e => m.setDraft(e.target.value)} placeholder="Message Alohak" rows={1} disabled={!m.workspace || !m.snapshot.sessionId && !m.draftMode} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void m.send(); } }} />
      {m.workspace && <PreviewSlots model={m.previews} chooseWorkspace={() => m.chooseWorkspace('')} />}
      {m.workspace && <button type="button" onClick={m.openPicker} disabled={!m.snapshot.sessionId && !m.draftMode}>Attach Beads</button>}
      {m.busy ? <button type="button" onClick={m.stop}>Stop</button> : <button disabled={!m.workspace || !m.snapshot.sessionId && !m.draftMode || m.snapshot.dirty || m.snapshot.phase !== 'idle' || !m.draft.trim()}>Send</button>}
    </form>
    <footer className="chat-composer-footer"><span>⚙ {m.selectedInference?.model ?? 'Choose a model'}</span><span>Build {process.env.NEXT_PUBLIC_APP_VERSION ?? 'development'}</span><span>{m.selectedStorage ? `S3 · ${m.selectedStorage.bucket}` : 'Choose storage'}</span></footer>
  </section>;
}
function Header({ model: m }: { model: ChatModel }) {
  return <>{!m.showList && <div className="chat-compact-tools"><button className="chat-icon-button" title="Conversations" aria-label="Conversations" onClick={() => m.setShowList(true)}><ChatIcon name="sidebar" /></button><button className="chat-brand" onClick={m.openAlohak}>Alohak</button><span className="chat-scope">{m.workspace?.workspace ?? 'Unassigned migration inbox'}</span><button className="chat-icon-button" title="Change workspace" aria-label="Change workspace" disabled={m.busy || m.snapshot.dirty || m.previews.busy} onClick={() => m.chooseWorkspace('')}><ChatIcon name="switch" /></button><button className="chat-icon-button" title="New conversation" aria-label="New conversation" disabled={!m.canCreate || m.busy || m.snapshot.dirty || !m.selectedInference || !m.selectedStorage} onClick={() => void m.create()}><ChatIcon name="draft" /></button><button className="chat-icon-button" title="Settings" aria-label="Settings" onClick={m.openSettings}><ChatIcon name="settings" /></button></div>}<nav className="chat-toolbar" aria-label="Workspace tabs"><div role="tablist" aria-label="Workspace"><button role="tab" aria-selected={m.panel === 'chat'} aria-controls="chat-panel" id="chat-tab" onClick={() => m.choosePanel('chat')}>Chat</button><button role="tab" aria-selected={m.panel === 'beads'} aria-controls="beads-panel" id="beads-tab" disabled={!m.workspace} onClick={() => m.choosePanel('beads')}>Beads</button></div></nav></>;
}
function WorkspaceChooser({ model: m }: { model: ChatModel }) {
  return <section className="chat-workspace-chooser"><h1>Choose workspace</h1><p>Conversations, previews and information are scoped to the workspace in the URL.</p>
    {m.error && <p role="alert">{m.error}</p>}
    {m.previews.busy && <p role="status">Discovering workspaces…</p>}
    {m.previews.error && <p>{m.previews.error}</p>}
    <label>Workspace<select aria-label="Choose workspace" value="" disabled={m.busy || m.previews.busy} onChange={event => m.chooseWorkspace(event.target.value)}><option value="">Select a workspace</option>{m.workspaces.map(workspace => <option key={workspaceKey(workspace)} value={workspaceKey(workspace)}>{workspace.workspace} · {workspace.repository}</option>)}</select></label>
    <p><a href="../app/#/documents" target="_blank" rel="noopener noreferrer">Browse workspaces in Documents</a></p><button disabled={m.busy || m.previews.busy} onClick={() => void m.previews.refresh()}>Refresh workspaces</button>
    <button disabled={m.busy || m.previews.busy} onClick={() => m.chooseWorkspace('inbox')}>Unassigned migration inbox</button>
  </section>;
}
function Shell({ model, device }: { model: ChatModel; device: string }) { return <main className={`chat-app chat-${device}${model.showList && model.route.kind !== 'chooser' ? ' chat-list-open' : ''}`}>{model.route.kind === 'chooser' ? <div className="chat-chooser-page"><div className="chat-compact-tools"><button className="chat-brand" onClick={model.openAlohak}>Alohak</button><button className="chat-icon-button" aria-label="Settings" title="Settings" onClick={model.openSettings}><ChatIcon name="settings" /></button></div><WorkspaceChooser model={model} /></div> : <div className="chat-columns">{model.showList && <Library model={model} />}<div className="chat-workspace"><Header model={model} /><div className="chat-panel" id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" hidden={model.panel !== 'chat'}><Conversation model={model} /></div><div className="chat-panel" id="beads-panel" role="tabpanel" aria-labelledby="beads-tab" hidden={model.panel !== 'beads'}><BeadsView model={model.beads} dark={model.theme.isDark} attach={() => model.attach()} /></div></div></div>}<Settings model={model} /><BeadDialogs model={model} /></main>; }
export function PhoneChat({ model }: { model: ChatModel }) { return <Shell model={model} device="phone" />; }
export function TabletChat({ model }: { model: ChatModel }) { return <Shell model={model} device="tablet" />; }
export function DesktopChat({ model }: { model: ChatModel }) { return <Shell model={model} device="desktop" />; }

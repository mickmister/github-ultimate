'use client';
import type { ChatModel } from './Chat.hooks';
import { ChatIcon } from './ChatIcon.view';

/** Conversation-row presentation adapted from upstream SessionSidebar/SessionItem
 * (agegr, MIT; see pi-web/UPSTREAM.md). Data and actions use our S3 conversation model. */
export function SessionSidebar({ model: m }: { model: ChatModel }) {
  return <nav className="chat-library" aria-label="Saved conversations"><div className="chat-sidebar-brand"><button className="chat-brand" onClick={m.openAlohak}>Alohak</button><button className="chat-icon-button" title="Hide conversations" aria-label="Hide conversations" onClick={() => m.setShowList(false)}><ChatIcon name="sidebar" /></button></div>
    <div className="chat-sidebar-controls"><div className="chat-sidebar-workspace"><strong title={m.workspace?.workspace}>{m.workspace?.workspace ?? 'Unassigned migration inbox'}</strong><button className="chat-icon-button" title="Change workspace" aria-label="Change workspace" disabled={m.busy || m.snapshot.dirty || m.previews.busy} onClick={() => m.chooseWorkspace('')}><ChatIcon name="switch" /></button></div>
    <div className="chat-sidebar-actions"><input type="search" aria-label="Search conversations" placeholder="Search…" value={m.search} onChange={event => m.setSearch(event.target.value)} />
    <button className="chat-icon-button" title="Refresh conversations" aria-label="Refresh conversations" disabled={m.busy || !m.selectedStorage || m.snapshot.dirty} onClick={() => void m.list()}><ChatIcon name="refresh" /></button><button className="chat-icon-button" title="New conversation" aria-label="New conversation" disabled={!m.canCreate || m.busy || m.snapshot.dirty || !m.selectedInference || !m.selectedStorage} onClick={() => void m.create()}><ChatIcon name="draft" /></button></div></div>
    {!m.chats.length && <p>{m.search.trim() ? 'No matching conversations.' : 'No conversations yet.'}</p>}
    <ul>{m.chats.map(item => <li key={item.sessionId}><button className="chat-session-row" disabled={m.busy || m.snapshot.dirty} aria-current={m.snapshot.sessionId === item.sessionId ? 'page' : undefined} onClick={() => void m.open(item)}>
      <span className="chat-session-title" title={item.label}>{item.label}</span>
      <span className="chat-session-meta"><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time><span>{item.messageCount} messages</span></span>
    </button></li>)}</ul>
    <div className="chat-sidebar-footer"><button className="chat-icon-button" title="Settings" aria-label="Settings" onClick={m.openSettings}><ChatIcon name="settings" /></button></div>
  </nav>;
}

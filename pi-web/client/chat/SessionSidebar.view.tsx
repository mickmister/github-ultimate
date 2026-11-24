'use client';
import type { ChatModel } from './Chat.hooks';
import type { ReactNode } from 'react';
import { workspaceKey } from './Chat.hooks';

/** Conversation-row presentation adapted from upstream SessionSidebar/SessionItem
 * (agegr, MIT; see pi-web/UPSTREAM.md). Data and actions use our S3 conversation model. */
export function SessionSidebar({ model: m, children }: { model: ChatModel; children?: ReactNode }) {
  return <nav className="chat-library" aria-label="Saved conversations"><div className="chat-sidebar-brand"><strong>Pi Agent Web</strong><button disabled={!m.canCreate || m.busy || m.snapshot.dirty || !m.selectedInference || !m.selectedStorage} onClick={() => void m.create()} aria-label="New conversation"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New</button><button aria-label="Hide conversations" onClick={() => m.setShowList(false)}>‹</button></div>
    <div className="chat-sidebar-controls"><h2>Conversations</h2>
    <select aria-label="Conversation workspace" value={workspaceKey(m.workspace)} disabled={m.busy || m.snapshot.dirty || m.previews.busy} onChange={event => m.chooseWorkspace(event.target.value)}><option value="">Unassigned</option>{m.workspaces.map(workspace => <option key={workspaceKey(workspace)} value={workspaceKey(workspace)}>{workspace.workspace} · {workspace.repository}</option>)}</select>
    <input type="search" aria-label="Search conversations" placeholder="Search conversations" value={m.search} onChange={event => m.setSearch(event.target.value)} />
    <button disabled={m.busy || !m.selectedStorage || m.snapshot.dirty} onClick={() => void m.list()}>Refresh conversations</button></div>
    {!m.chats.length && <p>{m.search.trim() ? 'No matching conversations.' : 'No conversations yet.'}</p>}
    <ul>{m.chats.map(item => <li key={item.sessionId}><button className="chat-session-row" disabled={m.busy || m.snapshot.dirty} aria-current={m.snapshot.sessionId === item.sessionId ? 'page' : undefined} onClick={() => void m.open(item)}>
      <span className="chat-session-title" title={item.label}>{item.label}</span>
      <span className="chat-session-meta"><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time><span>{item.messageCount} messages</span></span>
    </button></li>)}</ul>
    <div className="chat-sidebar-footer">{children}</div>
  </nav>;
}

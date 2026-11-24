'use client';
import type { ChatModel } from './Chat.hooks';

/** Conversation-row presentation adapted from upstream SessionSidebar/SessionItem
 * (agegr, MIT; see pi-web/UPSTREAM.md). Data and actions use our S3 conversation model. */
export function SessionSidebar({ model: m }: { model: ChatModel }) {
  return <nav className="chat-library" aria-label="Saved conversations"><h2>Conversations</h2>
    <input type="search" aria-label="Search conversations" placeholder="Search conversations" value={m.search} onChange={event => m.setSearch(event.target.value)} />
    <button disabled={m.busy || !m.selectedStorage || m.snapshot.dirty} onClick={() => void m.list()}>Refresh conversations</button>
    {!m.chats.length && <p>{m.search.trim() ? 'No matching conversations.' : 'No conversations yet.'}</p>}
    <ul>{m.chats.map(item => <li key={item.sessionId}><button className="chat-session-row" disabled={m.busy || m.snapshot.dirty} aria-current={m.snapshot.sessionId === item.sessionId ? 'page' : undefined} onClick={() => void m.open(item)}>
      <span className="chat-session-title" title={item.label}>{item.label}</span>
      <span className="chat-session-meta"><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time><span>{item.messageCount} messages</span></span>
    </button></li>)}</ul>
    <p className="chat-help">Each conversation opens its most recently saved continuation. Shared links keep their exact history.</p>
  </nav>;
}

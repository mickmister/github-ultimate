'use client';

import { useState } from 'react';
import { createBrowserSession, extensionRuntime, type Connection } from './session';
import './connection.css';

export function ConnectionBar({ onOpenSession }: { onOpenSession(id: string): void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('Sample chats are simulated. Connect to start a real Pi session.');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string>();
  async function connect() {
    setBusy(true); setStatus('Connecting to the extension…');
    try {
      const list = await (await extensionRuntime()).connections();
      setConnections(list); setSelected(list[0]?.id ?? '');
      setStatus(list.length ? 'Choose an inference connection. Real sessions stay in this tab only.' : 'No inference connections are granted to this page. Add one in extension settings and grant this Pi Web path, then retry.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not connect.'); }
    finally { setBusy(false); }
  }
  async function start() {
    const connection = connections.find(item => item.id === selected);
    if (!connection) return;
    setBusy(true);
    try {
      const id = await createBrowserSession(await extensionRuntime(), connection);
      setSession(id); onOpenSession(id);
      setStatus(`Real Pi session: ${connection.name} · ${connection.model}. This tab only; no shell or files.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not start Pi.'); }
    finally { setBusy(false); }
  }
  return <aside className="extension-connection" aria-label="Extension inference">
    <div className="extension-connection-controls">
      <button onClick={() => void connect()} disabled={busy}>Connect inference</button>
      {connections.length > 0 && <><select aria-label="Inference connection" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
        {connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
      </select><button onClick={() => void start()} disabled={busy || !selected}>New real Pi session</button></>}
      {session && <button onClick={() => onOpenSession(session)}>Open real session</button>}
    </div>
    <p role="status">{status}</p>
  </aside>;
}

import type { PreviewSlotsModel } from './PreviewSlots.hooks';

export function PreviewSlots({ model: m }: { model: PreviewSlotsModel }) {
  return <details className="chat-previews" open={m.open} onToggle={event => m.toggle(event.currentTarget.open)}>
    <summary aria-label="Preview slots">Previews ↗</summary>
    <div className="chat-preview-menu" aria-label="Workspace previews">
      {m.catalog?.workspace && <strong>{m.catalog.workspace}</strong>}
      {m.busy && <p role="status">Loading previews…</p>}
      {m.error && <p role="alert">{m.error}</p>}
      {!m.busy && !m.error && !m.catalog?.slots.length && <p>No preview slots configured.</p>}
      <ul>{m.catalog?.slots.map(slot => <li key={slot.id}>{slot.url
        ? <a href={slot.url} target="_blank" rel="noopener noreferrer" title={`${slot.repository} · ${slot.service}`}>{slot.title}<small>{slot.repository}</small></a>
        : <span title={slot.error}>{slot.title}<small>{slot.error}</small></span>}</li>)}</ul>
      <div className="chat-preview-actions"><a href="../app/#/documents" target="_blank" rel="noopener noreferrer">Choose workspace</a><button type="button" disabled={m.busy} onClick={() => void m.refresh()}>Refresh previews</button></div>
    </div>
  </details>;
}

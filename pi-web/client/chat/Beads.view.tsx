'use client';
import { Kanban, Willow, WillowDark, type KanbanCard } from '@svar-ui/react-kanban';
import { BeadSelection, type BeadsModel } from './Beads.hooks';
import type { ChatModel } from './Chat.hooks';
import '@svar-ui/react-kanban/style.css';
import './beads.css';

const modal = (element: HTMLDialogElement | null) => { if (element && !element.open) element.showModal(); };
function Card({ card }: { card: KanbanCard }) {
  const value = card as BeadsModel['cards'][number];
  return <BeadSelection.Consumer>{selection => <article className="pi-bead-card" data-selected={selection.has(value.id) || undefined} onContextMenu={event => { event.preventDefault(); value.context(); }} onPointerDown={event => { if (!(event.target as HTMLElement).closest('input')) value.down(event); }} onPointerMove={value.move} onPointerUp={value.up} onPointerCancel={value.up}>
    <div className="pi-bead-meta"><input type="checkbox" aria-label={`Select ${value.id}`} checked={selection.has(value.id)} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={event => value.select((event.nativeEvent as MouseEvent).shiftKey)} /><code>{value.id}</code><span>P{value.issue.priority ?? '?'}</span></div>
    <button className="pi-bead-title" onClick={event => value.open(event.ctrlKey || event.metaKey, event.shiftKey)}>{value.issue.title}</button>
    <div className="pi-bead-meta"><span>{value.issue.type}</span>{value.ready && <span>Ready</span>}{value.blocked && <span>Dependency blocked</span>}</div>
    {value.density === 'comfortable' && <><div>{value.issue.assignee || 'Unassigned'}</div><div>{value.issue.labels.join(' · ')}</div><p>{value.issue.description.slice(0, 240)}</p></>}
  </article>}</BeadSelection.Consumer>;
}
export function BeadsView({ model: m, dark, attach }: { model: BeadsModel; dark: boolean; attach(): void }) {
  const Theme = dark ? WillowDark : Willow;
  return <section className="pi-beads" aria-label="Workspace Beads">
    <div className="pi-beads-toolbar"><h1>Beads</h1><button onClick={m.refresh} disabled={m.state.phase === 'loading'}>Refresh Beads</button><span aria-live="polite">{m.state.phase === 'loading' ? 'Loading Beads…' : m.state.phase === 'ready' ? `${m.cards.length} / ${m.total}` : ''}</span></div>
    {(m.state.error || m.error) && <p role="alert">{m.state.error || m.error}</p>}
    <fieldset className="pi-beads-controls" disabled={!m.settingsReady} aria-label="Beads filters" aria-busy={!m.settingsReady || m.saving}>
      <input aria-label="Search Beads" type="search" placeholder="Search Beads" maxLength={500} value={m.preferences.filters.query} onChange={event => m.filter({ query: event.target.value })} />
      <select aria-label="Saved Beads filters" value={m.preferences.selectedView} onChange={event => m.selectView(event.target.value)}><option value="">Current filters</option>{m.preferences.views.map(view => <option key={view.name}>{view.name}</option>)}</select>
      <button aria-expanded={m.filtersOpen} onClick={m.toggleFilters}>Filters</button>
      {m.filtersOpen && <div className="pi-beads-settings">
        <label>Label<select value={m.preferences.filters.label} onChange={event => m.filter({ label: event.target.value })}><option value="">All labels</option>{m.options.labels.map(label => <option key={label}>{label}</option>)}</select></label>
        <label>Assignee<select value={m.preferences.filters.assignee} onChange={event => m.filter({ assignee: event.target.value })}><option value="">All assignees</option><option value="__unassigned">Unassigned</option>{m.options.assignees.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Issue type<select value={m.preferences.filters.type} onChange={event => m.filter({ type: event.target.value })}><option value="">All types</option>{m.options.types.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Readiness<select value={m.preferences.filters.readiness} onChange={event => m.filter({ readiness: event.target.value })}><option value="">All</option><option value="ready">Ready</option><option value="blocked">Dependency blocked</option></select></label>
        <label>Card density<select value={m.preferences.density} onChange={event => m.update(value => ({ ...value, density: event.target.value as 'compact' | 'comfortable' }))}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
        <label><input type="checkbox" checked={m.preferences.filters.closed} onChange={event => m.filter({ closed: event.target.checked })} /> Include closed</label><button onClick={m.clearFilters}>Clear filters</button>
        <input aria-label="Beads filter name" placeholder="Filter name" maxLength={60} value={m.filterName} onChange={event => m.setFilterName(event.target.value)} /><button disabled={!m.filterName.trim() || m.saving} onClick={m.saveFilter}>{m.saving ? 'Saving…' : 'Save filters'}</button><button disabled={!m.preferences.selectedView || m.saving} onClick={m.deleteView}>Delete saved filter</button>
      </div>}
    </fieldset>
    {m.selected.length > 0 && <div className="pi-beads-selection"><span>{m.selected.length} selected</span><button onClick={attach} disabled={m.selected.length > 50}>Attach as Context ({m.selected.length})</button><button onClick={m.clearSelection}>Clear selection</button>{m.selected.length > 50 && <span>Select at most 50 Beads.</span>}</div>}
    {m.state.phase === 'ready' && (m.cards.length ? <div className="pi-beads-board"><BeadSelection.Provider value={m.selection}><Theme><Kanban readonly cards={m.cards} columns={m.columns} cardContent={Card} render={{ fixedColumnWidth: true, columnScroll: true, virtualizeCards: true, estimatedCardHeight: m.preferences.density === 'compact' ? 145 : 240 }} /></Theme></BeadSelection.Provider></div> : <p>{m.total ? 'No matching Beads.' : 'No Beads yet.'}</p>)}
    {m.menu && <dialog ref={modal} className="pi-beads-dialog pi-beads-menu" aria-label="Beads actions" onCancel={m.closeMenu}><h2>{m.selected.length} Beads selected</h2><button disabled={!m.selected.length || m.selected.length > 50} onClick={attach}>Attach as Context ({m.selected.length})</button><button onClick={m.closeMenu}>Cancel</button></dialog>}
    {m.details && <dialog ref={modal} className="pi-beads-dialog" aria-label={`Bead details: ${m.details.id}`} onCancel={m.closeDetails}><header><h2>{m.details.id}</h2><button onClick={m.closeDetails}>Close details</button></header><h3>{m.details.title}</h3><p>{m.details.status} · {m.details.type} · P{m.details.priority ?? '?'}</p><p>{m.details.labels.join(' · ')}</p><div className="pi-bead-description">{m.details.description}</div><button onClick={() => { m.select(m.details!.id); m.closeDetails(); }}>Toggle selection</button></dialog>}
  </section>;
}
export function BeadDialogs({ model: m }: { model: ChatModel }) {
  return <>
    {m.attachment && <dialog ref={modal} className="pi-beads-dialog" aria-label="Attach Beads as context" onCancel={m.closeAttachment}>
      <form onSubmit={event => { event.preventDefault(); void m.sendAttachment(); }}><header><h2>Attach Beads as context</h2><button type="button" onClick={m.closeAttachment}>Cancel</button></header>
        <ul className="pi-beads-references">{m.attachment.beads.map(bead => <li key={bead.id}><span>{bead.title} <code>{bead.id}</code></span><button type="button" aria-label={`Remove ${bead.id}`} onClick={() => m.changeAttachment({ beads: m.attachment!.beads.filter(value => value.id !== bead.id) })}>×</button></li>)}</ul>
        <label>Search conversations<input value={m.destinationSearch} onChange={event => m.setDestinationSearch(event.target.value)} /></label>
        <label>Conversation<select value={m.attachment.destination} onChange={event => m.changeAttachment({ destination: event.target.value })}>
          {(m.snapshot.sessionId || m.draftMode) && <option value="current">Current: {m.snapshot.title}</option>}<option value="new">New conversation</option>
          {m.workspaceChats.filter(chat => chat.sessionId !== m.snapshot.sessionId && (chat.sessionId === m.attachment!.destination || chat.label.toLowerCase().includes(m.destinationSearch.toLowerCase()))).map(chat => <option key={chat.sessionId} value={chat.sessionId}>{chat.label}</option>)}
        </select></label>
        <label>Message<textarea required aria-label="Context message" rows={4} value={m.attachment.message} onChange={event => m.changeAttachment({ message: event.target.value })} /></label>
        {m.attachment.error && <p role="alert">{m.attachment.error}</p>}
        <button type="submit" disabled={m.busy || !m.attachment.message.trim() || !m.attachment.beads.length || m.attachment.beads.length > 50}>Send message</button>
      </form>
    </dialog>}
    {m.pickerOpen && <dialog ref={modal} className="pi-beads-dialog" aria-label="Attach Beads" onCancel={m.closePicker}><header><h2>Attach Beads</h2><button onClick={m.closePicker}>Cancel</button></header>
      <input aria-label="Find Beads" placeholder="Search title or ID" value={m.pickerSearch} onChange={event => m.setPickerSearch(event.target.value)} />
      {m.beads.state.phase === 'loading' && <p role="status">Loading Beads…</p>}{m.beads.state.error && <p role="alert">{m.beads.state.error}</p>}
      <ul className="pi-beads-picker">{m.beads.issues.filter(issue => `${issue.id} ${issue.title}`.toLowerCase().includes(m.pickerSearch.toLowerCase())).slice(0, 100).map(issue => <li key={issue.id}><label><input type="checkbox" checked={m.beads.selected.some(value => value.id === issue.id)} onChange={() => m.beads.select(issue.id)} /><span>{issue.title}<small>{issue.id} · {issue.status} · {issue.type}</small></span></label></li>)}</ul>
      <button disabled={!m.beads.selected.length || m.beads.selected.length > 50} onClick={m.addPickedBeads}>Add to message ({m.beads.selected.length})</button>
    </dialog>}
  </>;
}

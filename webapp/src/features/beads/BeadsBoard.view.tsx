import { Kanban, Willow, WillowDark, type ColumnConfig, type KanbanCard } from '@svar-ui/react-kanban';
import type { RefObject } from 'react';
import { text, type BoardFilters, type BoardIssue } from './board';
import '@svar-ui/react-kanban/style.css';
import './beads.css';

type BoardCard = KanbanCard & { issue: BoardIssue; ready: boolean; blocked: boolean; density: string; selected: boolean; open(): void };
type Props = {
  model: { workspace: string; cards: BoardCard[]; columns: ColumnConfig[]; total: number; filters: BoardFilters; density: string; dark: boolean;
    options: { labels: string[]; assignees: string[]; types: string[] }; selected?: BoardIssue;
    readyAvailable: boolean; blockedAvailable: boolean; selectedReady: boolean; selectedBlocked: boolean; error: string; loaded: boolean };
  actions: { filter(patch: Partial<BoardFilters>): void; clear(): void; density(value: 'compact' | 'comfortable'): void; close(): void };
  detailsRef: RefObject<HTMLElement | null>;
};
function BeadsCardView({ card }: { card: KanbanCard }) {
  const value = card as BoardCard, issue = value.issue;
  return <button type="button" className="beads-card" data-selected={value.selected || undefined} aria-label={`Open ${issue.id}: ${issue.title}`} onClick={event => { event.stopPropagation(); value.open(); }}>
    <span className="beads-card-meta"><code>{issue.id}</code><span>{issue.priority === null ? 'Priority unknown' : `P${issue.priority}`}</span></span>
    <strong>{issue.title}</strong><span className="beads-card-meta"><span>{issue.type} · {issue.status}</span>{value.ready && <span className="beads-badge">Ready</span>}{value.blocked && <span className="beads-badge">Dependency blocked</span>}</span>
    {value.density === 'comfortable' && <><span>{issue.assignee || 'Unassigned'}</span><span>{issue.labels.slice(0, 3).join(' · ')}{issue.labels.length > 3 ? ` +${issue.labels.length - 3}` : ''}</span><span className="beads-card-preview">{issue.description}</span></>}
  </button>;
}
export function BeadsBoardView({ model, actions, detailsRef }: Props) {
  const Theme = model.dark ? WillowDark : Willow;
  return <section className="beads-board" aria-label="Workspace Beads Kanban">
    <div className="section-heading"><div><h2>Workspace Kanban</h2><p className="muted">{model.workspace || 'Choose a workspace'} · Read-only · Columns show stored status</p></div>
      <label>Card density<select value={model.density} onChange={event => actions.density(event.target.value as 'compact' | 'comfortable')}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
    </div>
    <div className="beads-filters">
      <label>Search issues<input type="search" value={model.filters.query} placeholder="Issue ID or title" onChange={event => actions.filter({ query: event.target.value })} /></label>
      <label>Label<select value={model.filters.label} onChange={event => actions.filter({ label: event.target.value })}><option value="">All labels</option>{model.options.labels.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Assignee<select value={model.filters.assignee} onChange={event => actions.filter({ assignee: event.target.value })}><option value="">All assignees</option><option value="__unassigned">Unassigned</option>{model.options.assignees.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Issue type<select value={model.filters.type} onChange={event => actions.filter({ type: event.target.value })}><option value="">All types</option>{model.options.types.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Native readiness<select value={model.filters.readiness} onChange={event => actions.filter({ readiness: event.target.value })}><option value="">All issues</option><option value="ready" disabled={!model.readyAvailable}>Ready (open)</option><option value="blocked" disabled={!model.blockedAvailable}>Dependency blocked</option></select></label>
      <label className="beads-checkbox"><input type="checkbox" checked={model.filters.closed} onChange={event => actions.filter({ closed: event.target.checked })} />Include closed</label><button onClick={actions.clear}>Clear filters</button>
    </div>
    {model.error ? <p role="alert" className="error">{model.error}</p> : !model.loaded ? <p className="welcome">Load the workspace snapshot to browse its issues.</p> : <>
      <p className="beads-count" aria-live="polite">{model.cards.length} matching / {model.total} issues in the pinned snapshot · Priority, then ID</p>
      {!model.readyAvailable || !model.blockedAvailable ? <p className="muted">Native readiness is unavailable until the ready and blocked reads succeed.</p> : null}
      {model.total === 0 ? <p className="welcome">This workspace snapshot has no issues.</p> : model.cards.length === 0 ? <p className="welcome">No issues match these filters.</p> : <div className="beads-board-layout" data-details={Boolean(model.selected)}>
        <div className="beads-board-viewport"><Theme><Kanban readonly cards={model.cards} columns={model.columns} cardContent={BeadsCardView} render={{ fixedColumnWidth: true, columnScroll: true, virtualizeCards: true, estimatedCardHeight: model.density === 'compact' ? 150 : 240, cardOverscan: 4 }} /></Theme></div>
      </div>}
    </>}
    {model.selected && <aside className="beads-detail connection-panel" aria-label={`Issue details: ${model.selected.id}`} tabIndex={-1} ref={detailsRef} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); actions.close(); } }}>
      <div className="section-heading"><h2>{model.selected.id}</h2><button onClick={actions.close}>Close issue details</button></div><h3>{model.selected.title}</h3>
      <dl className="beads-metadata"><dt>Stored status</dt><dd>{model.selected.status}</dd><dt>Priority</dt><dd>{model.selected.priority === null ? 'Unknown' : `P${model.selected.priority}`}</dd><dt>Type</dt><dd>{model.selected.type}</dd><dt>Assignee</dt><dd>{model.selected.assignee || 'Unassigned'}</dd><dt>Labels</dt><dd>{model.selected.labels.join(', ') || 'None'}</dd>
        <dt>Native readiness</dt><dd>{model.selectedReady ? 'Ready (open)' : model.selectedBlocked ? 'Dependency blocked' : model.readyAvailable && model.blockedAvailable ? 'Not in ready or blocked results' : 'Unavailable'}</dd>
        {['created_at', 'updated_at', 'closed_at'].filter(key => text(model.selected!.raw[key])).map(key => <div className="beads-metadata-row" key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{text(model.selected!.raw[key])}</dd></div>)}
      </dl><h4>Description</h4><p className="beads-description">{model.selected.description || 'No description.'}</p>
      <details><summary>Complete native issue record</summary><pre>{JSON.stringify(model.selected.raw, null, 2)}</pre></details>
      <p className="muted">Read-only snapshot. Refresh the workspace to see newly published changes.</p>
    </aside>}
  </section>;
}

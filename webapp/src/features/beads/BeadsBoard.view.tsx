import { Kanban, Willow, WillowDark, type KanbanCard } from '@svar-ui/react-kanban';
import type { BeadsBoardModel } from './contracts';
import { text, detailTabIndex } from './board';
import { copy, openLabel, detailsLabel, priorityLabel, countLabel, pageLabel } from './Beads.copy';
import '@svar-ui/react-kanban/style.css';
import './beads.css';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

export type BoardProps = BeadsBoardModel;
type BoardCard = BoardProps['model']['cards'][number];
export function BeadsCardView({ card }: { card: KanbanCard }) {
  const value = card as BoardCard, issue = value.issue;
  return <button id={`beads-task-${issue.id}`} type="button" className="beads-card" data-selected={value.selected || undefined} aria-label={openLabel(issue.id, issue.title)} onClick={event => { event.stopPropagation(); value.open(); }}>
    <span className="beads-card-meta"><code>{issue.id}</code><span>{priorityLabel(issue.priority)}</span></span>
    <strong>{issue.title}</strong><span className="beads-card-meta"><span>{[issue.type, issue.status].join(' · ')}</span>{value.ready && <span className="beads-badge">{copy.ready}</span>}{value.blocked && <span className="beads-badge">{copy.blocked}</span>}</span>
    {value.density === 'comfortable' && <><span>{issue.assignee || copy.unassigned}</span><span>{issue.labels.join(' · ')}</span><span className="beads-card-preview">{issue.description}</span></>}
  </button>;
}
export function BoardControls({ model, actions }: BoardProps) {
  return <><fieldset className="beads-controls" disabled={!model.preferencesReady} aria-label={copy.boardFilters} aria-busy={!model.preferencesReady || model.preferencesSaving}>
    <div className="beads-toolbar">
      <input id="beads-search" aria-label={copy.search} type="search" value={model.filters.query} placeholder={copy.search} maxLength={500} onChange={event => actions.filter({ query: event.target.value })} />
      <select aria-label={copy.saved} value={model.selectedView} onChange={event => actions.selectView(event.target.value)}><option value="">{Object.values(model.filters).some(Boolean) ? copy.custom : copy.active}</option>{model.views.map(view => <option key={view.name} value={view.name}>{view.name}</option>)}</select>
      <button type="button" aria-expanded={model.filtersOpen} aria-controls="beads-filter-settings" onClick={actions.toggleFilters}>{copy.filters}</button>
      {model.loaded && <span className="beads-count" aria-live="polite">{countLabel(model.cards.length, model.total)}</span>}
    </div>
    {model.filtersOpen && <div id="beads-filter-settings" className="beads-filter-settings"><div className="beads-filters">
      <label>{copy.label}<select value={model.filters.label} onChange={event => actions.filter({ label: event.target.value })}><option value="">{copy.allLabels}</option>{model.options.labels.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>{copy.assignee}<select value={model.filters.assignee} onChange={event => actions.filter({ assignee: event.target.value })}><option value="">{copy.allAssignees}</option><option value="__unassigned">{copy.unassigned}</option>{model.options.assignees.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>{copy.type}<select value={model.filters.type} onChange={event => actions.filter({ type: event.target.value })}><option value="">{copy.allTypes}</option>{model.options.types.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>{copy.readiness}<select value={model.filters.readiness} onChange={event => actions.filter({ readiness: event.target.value })}><option value="">{copy.allIssues}</option><option value="ready" disabled={!model.readyAvailable}>{copy.ready}</option><option value="blocked" disabled={!model.blockedAvailable}>{copy.blocked}</option></select></label>
      <label>{copy.density}<select value={model.density} onChange={event => actions.density(event.target.value as 'compact' | 'comfortable')}><option value="compact">{copy.compact}</option><option value="comfortable">{copy.comfortable}</option></select></label>
      <label className="beads-checkbox"><input type="checkbox" checked={model.filters.closed} onChange={event => actions.filter({ closed: event.target.checked })} />{copy.closed}</label><button type="button" onClick={actions.clear}>{copy.clear}</button>
    </div><form className="beads-save-filter" onSubmit={event => { event.preventDefault(); actions.saveFilter(); }}><input aria-label={copy.filterName} placeholder={copy.filterName} maxLength={60} value={model.filterName} onChange={event => actions.filterName(event.target.value)} /><button type="submit" disabled={!model.filterName.trim() || model.preferencesSaving}>{model.preferencesSaving ? copy.saving : copy.save}</button><button type="button" disabled={!model.selectedView || model.preferencesSaving} onClick={actions.deleteView}>{copy.delete}</button></form></div>}
  </fieldset>{model.preferencesError && <aside role="status" aria-label={copy.filterStorage}><p>{model.preferencesError}</p><button type="button" onClick={actions.dismissPreferencesError}>{copy.dismissFilters}</button></aside>}</>;
}
export function BoardStatus({ model }: BoardProps) {
  return model.error ? <p role="alert" className="error">{model.error}</p> : !model.loaded ? model.loading ? <LoadingIndicator label={copy.loading} /> : <p role="status">{copy.unavailable}</p> : model.total === 0 ? <p role="status">{copy.empty}</p> : model.cards.length === 0 ? <p role="status">{copy.noMatches}</p> : null;
}
export function BoardDetails({ model, actions, detailsRef, phone = false }: BoardProps & { phone?: boolean }) {
  const issue = model.selected;
  return issue && <aside className="beads-detail connection-panel" aria-label={detailsLabel(issue.id)} tabIndex={detailTabIndex} ref={detailsRef} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); actions.close(); } }}>
    <div className="section-heading"><h2>{issue.id}</h2><button onClick={actions.close}>{phone ? copy.back : copy.close}</button></div><h3>{issue.title}</h3>
    <dl className="beads-metadata"><dt>{copy.status}</dt><dd>{issue.status}</dd><dt>{copy.priority}</dt><dd>{priorityLabel(issue.priority)}</dd><dt>{copy.type}</dt><dd>{issue.type}</dd><dt>{copy.assignee}</dt><dd>{issue.assignee || copy.unassigned}</dd><dt>{copy.labels}</dt><dd>{issue.labels.join(', ') || copy.none}</dd>
      <dt>{copy.readiness}</dt><dd>{model.selectedReady ? copy.ready : model.selectedBlocked ? copy.blocked : model.readyAvailable && model.blockedAvailable ? copy.notReady : copy.unavailable}</dd>
      {['created_at', 'updated_at', 'closed_at'].filter(key => text(issue.raw[key])).map(key => <div className="beads-metadata-row" key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{text(issue.raw[key])}</dd></div>)}
    </dl><h4>{copy.description}</h4><p className="beads-description">{issue.description || copy.noDescription}</p>
  </aside>;
}
export function BoardPagination({ model, actions }: BoardProps) {
  return model.cards.length > 60 && <nav className="beads-pagination" aria-label={copy.tasks}><button disabled={model.page === 0} onClick={actions.previous}>{copy.previous}</button><span>{pageLabel(model.page, model.cards.length)}</span><button disabled={(model.page + 1) * 60 >= model.cards.length} onClick={actions.next}>{copy.next}</button></nav>;
}
export function DesktopKanban({ model }: BoardProps) {
  const Theme = model.dark ? WillowDark : Willow;
  return model.loaded && !model.error && model.cards.length > 0 && <div className="beads-board-viewport"><Theme><Kanban readonly cards={model.cards} columns={model.columns} cardContent={BeadsCardView} render={{ fixedColumnWidth: true, columnScroll: true, virtualizeCards: true, estimatedCardHeight: model.density === 'compact' ? 150 : 240, cardOverscan: 4 }} /></Theme></div>;
}

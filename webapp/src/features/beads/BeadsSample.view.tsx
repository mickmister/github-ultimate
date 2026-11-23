import type { BeadsPageProps } from './contracts';
import { copy } from './Beads.copy';
import './beads.css';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';
export type { BeadsPageProps } from './contracts';
export function WorkspaceActions({ model, actions }: BeadsPageProps) {
  return <><button onClick={actions.edit} aria-expanded={model.editing} aria-controls="beads-workspace-picker">{model.loadedChoice?.workspace || copy.workspace}</button>
    {model.busy ? <button onClick={actions.cancel}>{copy.cancel}</button> : model.loadedChoice && <button onClick={actions.refresh}>{copy.refresh}</button>}
  </>;
}
export function WorkspaceLinks({ model }: BeadsPageProps) {
  const scope = model.loadedChoice ?? model.choice;
  return <nav aria-label={copy.pages}><a href={`#/documents?${new URLSearchParams(scope)}`}>{copy.documents}</a></nav>;
}
export function WorkspacePicker({ model, actions }: BeadsPageProps) {
  return model.editing && <form id="beads-workspace-picker" className="connection-panel beads-workspace-picker" aria-label={copy.workspace} onSubmit={event => { event.preventDefault(); actions.load(); }}><div className="connection-fields">
    <label>{copy.connection}<select value={model.choice.connection} disabled={model.busy} onChange={event => actions.choice({ connection: event.target.value })}><option value="">{copy.chooseConnection}</option>{model.connections.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    <label>{copy.repository}<input value={model.choice.repository} disabled={model.busy} placeholder={copy.repositoryExample} onChange={event => actions.choice({ repository: event.target.value })} /></label>
    <button type="button" disabled={!model.canDiscover || model.busy} onClick={actions.discover}>{copy.discover}</button>
    <label>{copy.workspaceLabel}<input value={model.choice.workspace} disabled={model.busy} list="beads-workspaces" onChange={event => actions.choice({ workspace: event.target.value })} /><datalist id="beads-workspaces">{model.workspaces.map(value => <option key={value} value={value} />)}</datalist></label>
    <button type="submit" className="primary" disabled={!model.canDiscover || !model.choice.workspace || model.busy}>{copy.openWorkspace}</button>
  </div></form>;
}
export function WorkspaceStatus({ model, actions }: BeadsPageProps) {
  return <>{model.status && (model.busy ? <LoadingIndicator compact={Boolean(model.loadedChoice)} label={model.status} /> : <p role="status" className="beads-loading">{model.status}</p>)}
    {model.error && <div role="alert" className="error"><p>{model.error}</p>{model.loadedChoice ? <button onClick={actions.refresh}>{copy.retry}</button> : <button onClick={actions.edit}>{copy.workspace}</button>}</div>}
    {model.preferencesError && <aside role="status" aria-label={copy.workspaceStorage}><p>{model.preferencesError}</p><button type="button" onClick={actions.dismissPreferencesError}>{copy.dismissWorkspace}</button></aside>}
  </>;
}

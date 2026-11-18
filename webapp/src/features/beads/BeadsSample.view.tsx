import type { HostedConnection } from '../../../../src/hosted-protocol';
import type { BeadsResult } from '../../../../hosted/beads-sample';
import type { WorkspaceChoice } from './preferences';
import { BeadsBoard } from './BeadsBoard';
import './beads.css';

type Props = {
  model: { connections: HostedConnection[]; choice: WorkspaceChoice; loadedChoice?: WorkspaceChoice; workspaces: string[]; busy: boolean; status: string; error: string; preferencesError: string; editing: boolean; results: BeadsResult[]; canDiscover: boolean };
  actions: { choice(patch: Partial<WorkspaceChoice>): void; edit(): void; discover(): void; load(): void; refresh(): void; cancel(): void; dismissPreferencesError(): void };
};
export function BeadsSampleView({ model, actions }: Props) {
  const scope = model.loadedChoice;
  return <main className="app-shell beads-page">
    <header className="beads-page-header"><h1>Kanban</h1><button onClick={actions.edit} aria-expanded={model.editing} aria-controls="beads-workspace-picker">{scope?.workspace || 'Choose workspace'}</button>
      {model.busy ? <button onClick={actions.cancel}>Cancel</button> : scope && <button onClick={actions.refresh}>Refresh</button>}
      <nav aria-label="Workspace pages"><a href={`#/documents?${new URLSearchParams({ connection: scope?.connection ?? model.choice.connection, repository: scope?.repository ?? model.choice.repository, workspace: scope?.workspace ?? model.choice.workspace })}`}>Documents</a></nav>
    </header>
    {model.editing && <form id="beads-workspace-picker" className="connection-panel beads-workspace-picker" aria-label="Choose workspace" onSubmit={event => { event.preventDefault(); actions.load(); }}><div className="connection-fields">
      <label>Connection<select value={model.choice.connection} disabled={model.busy} onChange={event => actions.choice({ connection: event.target.value })}><option value="">Choose a connection</option>{model.connections.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>Storage repository<input value={model.choice.repository} disabled={model.busy} placeholder="owner/storage-repository" onChange={event => actions.choice({ repository: event.target.value })} /></label>
      <button type="button" disabled={!model.canDiscover || model.busy} onClick={actions.discover}>Find workspaces</button>
      <label>Workspace<input value={model.choice.workspace} disabled={model.busy} list="beads-workspaces" onChange={event => actions.choice({ workspace: event.target.value })} /><datalist id="beads-workspaces">{model.workspaces.map(value => <option key={value} value={value} />)}</datalist></label>
      <button type="submit" className="primary" disabled={!model.canDiscover || !model.choice.workspace || model.busy}>Open workspace</button>
    </div></form>}
    {model.status && <p role="status" className="beads-loading">{model.status}</p>}
    {model.error && <p role="alert" className="error">{model.error}</p>}
    {model.preferencesError && <aside role="status" aria-label="Workspace preference storage"><p>{model.preferencesError}</p><button type="button" onClick={actions.dismissPreferencesError}>Dismiss workspace settings notice</button></aside>}
    {scope && <BeadsBoard key={JSON.stringify(scope)} results={model.results} workspace={scope.workspace} preferencesScope={JSON.stringify(scope)} />}
  </main>;
}

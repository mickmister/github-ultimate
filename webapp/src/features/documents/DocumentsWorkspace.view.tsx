import type { DocumentBrowserProps } from './contracts';
import { copy } from './Documents.copy';
export function DocumentsWorkspace({ model, actions }: DocumentBrowserProps) {
  return <section className="connection-panel" aria-label={copy.workspace}>
    <div className="section-heading"><h2>{copy.workspace}</h2><button disabled={model.busy} onClick={actions.connect}>{copy.reconnect}</button>{actions.forgetWorkspace && <button disabled={model.busy} onClick={actions.forgetWorkspace}>{copy.forget}</button>}</div>
    <div className="connection-fields">
      <label>{copy.connection}<select value={model.connectionId} onChange={e => actions.selectConnection(e.target.value)}><option value="">{copy.chooseConnection}</option>{model.connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{copy.repository}<input value={model.repository} placeholder={copy.repositoryExample} autoComplete="off" spellCheck={false} onChange={e => actions.setRepository(e.target.value)} /></label>
      <button disabled={!model.canDiscover} onClick={actions.discoverWorkspaces}>{copy.discover}</button>
      <label>{copy.storedWorkspace}<select value={model.workspaceId} onChange={e => actions.selectWorkspace(e.target.value)}><option value="">{copy.chooseWorkspace}</option>{model.workspaces.map(w => <option key={w.id} value={w.id} disabled={!w.hasDocuments}>{w.id}</option>)}</select></label>
      <button disabled={!model.canBrowse} onClick={actions.browseDocuments}>{copy.browse}</button>
    </div>
  </section>;
}

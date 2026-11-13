import type { HostedConnection } from '../../../../src/hosted-protocol';
import { beadsRelease, type BeadsOperation, type BeadsResult, type BeadsSession } from '../../../../hosted/beads-sample';
import './beads.css';

type Props = { model: { connections: HostedConnection[]; connection: string; repository: string; workspace: string; workspaces: string[]; valid: boolean; busy: boolean; status: string; error: string; session?: BeadsSession; results: BeadsResult[]; readOnly: boolean }; actions: { connection(value: string): void; repository(value: string): void; workspace(value: string): void; discover(): void; load(): void; query(operation: BeadsOperation): void; cancel(): void } };
export function BeadsSampleView({ model, actions }: Props) {
  return <main className="app-shell beads-sample">
    <header className="page-header"><div><p className="eyebrow">Native Beads · read-only proof</p><h1>Beads read sample</h1><p className="muted">Run upstream Beads queries against the selected workspace’s native Dolt files in an isolated browser Worker.</p></div><nav aria-label="Existing pages"><a href={`#/documents?${new URLSearchParams({ connection: model.connection, repository: model.repository, workspace: model.workspace })}`}>Documents</a><a href="../">Workspace dashboard</a><a href="../settings.html">Connection settings</a></nav></header>
    <section className="connection-panel" aria-label="Native workspace selection"><div className="connection-fields">
      <label>Approved connection<select value={model.connection} disabled={model.busy} onChange={event => actions.connection(event.target.value)}><option value="">Choose a connection</option>{model.connections.map(value => <option key={value.id} value={value.id}>{value.name} · {value.installation?.account}</option>)}</select></label>
      <label>Storage repository<input value={model.repository} disabled={model.busy} placeholder="owner/storage-repository" onChange={event => actions.repository(event.target.value)} /></label>
      <button disabled={!model.valid || model.busy} onClick={actions.discover}>Discover native workspaces</button>
      <label>Workspace<input value={model.workspace} disabled={model.busy} list="beads-workspaces" placeholder="Select or enter the workspace namespace" onChange={event => actions.workspace(event.target.value)} /><datalist id="beads-workspaces">{model.workspaces.map(value => <option key={value} value={value} />)}</datalist></label>
      <button className="primary" disabled={!model.valid || !model.workspace || model.busy} onClick={actions.load}>{model.session ? 'Refresh snapshot and run reads' : 'Load snapshot and run reads'}</button>
      {(model.busy || model.session) && <button onClick={actions.cancel}>{model.busy ? 'Cancel loading/query' : 'Dispose engine'}</button>}
    </div></section>
    <p role="status" aria-live="polite">{model.status}</p>{model.error && <p role="alert" className="error">{model.error}</p>}
    <details className="connection-panel"><summary>Verified engine release</summary><a href={beadsRelease.baseURL + 'manifest.json'}>{beadsRelease.baseURL}</a><p>Manifest SHA-256: <code>{beadsRelease.manifestSha256}</code></p></details>
    {model.session && <section className="connection-panel" aria-label="Verified native snapshot"><h2>Snapshot identity</h2><dl className="beads-metadata">
      <dt>Workspace</dt><dd>{model.repository} · {model.workspace}</dd><dt>Git snapshot</dt><dd><code>{model.session.gitCommit}</code></dd><dt>Dolt commit</dt><dd><code>{model.session.doltCommit}</code></dd><dt>Native storage root</dt><dd><code>{model.session.storageRoot}</code></dd><dt>Issue data root</dt><dd><code>{model.session.root}</code></dd><dt>Verified native files</dt><dd>{model.session.fileCount} · {(model.session.encodedBytes / 1048576).toFixed(1)} MiB</dd><dt>Read-only enforcement</dt><dd>{model.readOnly ? 'Verified: immutable store rejects writes and commits' : 'Checking…'}</dd>
    </dl><p className="muted">This is a pinned snapshot. Refresh creates a new Worker and resolves the workspace’s current published Git ref. Private bytes stay in the host/browser; only the engine is loaded from the CDN.</p></section>}
    <section aria-label="Beads read query results">{(['list', 'ready', 'blocked'] as const).map(operation => {
      const result = model.results.find(value => value.operation === operation);
      return <article key={operation} className="connection-panel"><div className="section-heading"><h2>{operation}</h2><button disabled={!model.readOnly || model.busy} onClick={() => actions.query(operation)}>Run {operation}</button></div>
        {result ? <><p>{result.issues?.length ?? 0} result(s) · {result.durationMs} ms{operation === 'list' ? ' · first 50, sorted by priority' : ''}</p><ol className="beads-issues">{result.issues?.slice(0, 20).map((issue, index) => <li key={String(issue.id ?? index)}><code>{String(issue.id)}</code> <strong>{String(issue.title)}</strong> <span className="muted">{String(issue.status)} · P{String(issue.priority)}</span></li>)}</ol><details><summary>Exact request and complete returned records</summary><pre>{JSON.stringify({ request: result.request, response: { issues: result.issues } }, null, 2)}</pre></details></> : <p className="muted">Load the selected workspace to run this query. An empty successful response is displayed as zero results.</p>}
      </article>;
    })}</section>
  </main>;
}

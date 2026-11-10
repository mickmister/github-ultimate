import type { DocumentBrowserProps } from './contracts';

export function DocumentBrowserView({ model, actions }: DocumentBrowserProps) {
  const entries = model.snapshot?.documents.filter(document => document.path.toLocaleLowerCase().includes(model.query.toLocaleLowerCase())) ?? [];
  const selected = model.snapshot?.documents.find(document => document.id === model.documentId);
  return <main className="app-shell">
    <header className="page-header">
      <div><p className="eyebrow">GitHub Ultimate · new web app</p><h1>Workspace documents</h1><p className="muted">Explore verified workspace snapshots through your browser extension.</p></div>
      <nav aria-label="Existing pages"><a href="../">Current dashboard</a><a href="../settings.html">Connection &amp; storage settings</a></nav>
    </header>
    <section className="connection-panel" aria-labelledby="connection-heading">
      <div className="section-heading"><h2 id="connection-heading">Choose your workspace</h2><button onClick={actions.connect} disabled={model.busy}>Reconnect extension</button></div>
      <div className="connection-fields">
        <label>Approved connection<select value={model.connectionId} onChange={event => actions.selectConnection(event.target.value)}><option value="">Choose a connection</option>{model.connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.account}</option>)}</select></label>
        <label>Storage repository<input value={model.repository} placeholder="owner/repository" autoComplete="off" spellCheck={false} onChange={event => actions.setRepository(event.target.value)} /></label>
        <button disabled={!model.canDiscover} onClick={actions.discoverWorkspaces}>Discover workspaces</button>
        <label>Stored workspace<select value={model.workspaceId} onChange={event => actions.selectWorkspace(event.target.value)}><option value="">Choose a workspace</option>{model.workspaces.map(workspace => <option key={workspace.id} value={workspace.id} disabled={!workspace.hasDocuments}>{workspace.id}{workspace.hasDocuments ? '' : ' — no manifest ref'}</option>)}</select></label>
        <button className="primary" disabled={!model.canBrowse} onClick={actions.browseDocuments}>Browse documents</button>
      </div>
    </section>
    <div className="request-status"><p role="status" aria-live="polite">{model.status}</p>{model.error && <p role="alert" className="error">{model.error}</p>}</div>
    {model.snapshot ? <section className="browser" aria-label="Document browser" aria-busy={model.busy}>
      <aside className="document-sidebar"><h2>Documents <span className="count">{model.snapshot.documents.length}</span></h2><label>Find a document<input type="search" value={model.query} onChange={event => actions.setQuery(event.target.value)} /></label>
        <ul className="document-list">{entries.map(document => <li key={document.id}><button aria-current={model.documentId === document.id ? 'true' : undefined} onClick={() => actions.selectDocument(document.id)}><span>{document.path}</span><small>{document.size === null ? 'Size unknown' : `${document.size.toLocaleString()} bytes`}</small></button></li>)}</ul>
        {!entries.length && <p className="muted">No documents match this search.</p>}
      </aside>
      <article className="document-preview"><header><h2>{selected?.path ?? 'Select a document'}</h2>{model.snapshot.purpose && <p>{model.snapshot.purpose}</p>}<p className="muted">Verified snapshot <code>{model.snapshot.commit}</code></p></header>
        <pre tabIndex={0} aria-label="Document content">{model.content ?? (model.documentId && model.busy ? 'Reading…' : 'Choose a document to read its verified contents.')}</pre>
      </article>
    </section> : <section className="welcome"><h2>Your documents, pinned to a snapshot</h2><p>Choose an approved connection and storage repository, discover a workspace, then browse its documents.</p><p className="muted">Sign-in and origin approval remain in extension connection settings. Document contents stay in this tab.</p></section>}
  </main>;
}

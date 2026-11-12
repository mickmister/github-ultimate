import type { DocumentBrowserProps } from './contracts';
import { isMarkdown } from './document-format';
import { MonacoDocument } from './MonacoDocument';
import { MarkdownDocument } from './MarkdownDocument';
import { DocumentTree } from './DocumentTree';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { AttachableContext } from '../feedback/AttachableContext';
import { documentFeedbackTarget } from './feedback-target';
import { FeedbackAnnotations } from '../feedback/FeedbackAnnotations';

export function DocumentBrowserView({ model, actions }: DocumentBrowserProps) {
  const selected = model.snapshot?.documents.find(document => document.id === model.documentId);
  const fullscreen = Boolean(selected && model.documentFullscreen);
  return <FeedbackProvider><main className={`app-shell${fullscreen ? ' document-fullscreen' : ''}`}>
    {!fullscreen && <><header className="page-header">
      <div><p className="eyebrow">GitHub Ultimate · new web app</p><h1>Workspace documents</h1><p className="muted">Explore verified workspace snapshots through your browser extension.</p></div>
      <nav aria-label="Existing pages"><a href={`#/reviews${model.snapshot ? '?' + new URLSearchParams({ connection: model.connectionId, repository: model.repository, workspace: model.workspaceId }) : ''}`}>Review requests</a><a href="../">Current dashboard</a><a href="../settings.html">Connection &amp; storage settings</a><a href="../s3.html">S3 object storage</a></nav>
    </header>
    <section className="connection-panel" aria-labelledby="connection-heading">
       <div className="section-heading"><h2 id="connection-heading">Choose your workspace</h2><div><button onClick={actions.connect} disabled={model.busy}>Reconnect host</button>{actions.forgetWorkspace && <button onClick={actions.forgetWorkspace} disabled={model.busy}>Forget saved workspace</button>}</div></div>
      <div className="connection-fields">
        <label>Approved connection<select value={model.connectionId} onChange={event => actions.selectConnection(event.target.value)}><option value="">Choose a connection</option>{model.connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.account}</option>)}</select></label>
        <label>Storage repository<input value={model.repository} placeholder="owner/repository" autoComplete="off" spellCheck={false} onChange={event => actions.setRepository(event.target.value)} /></label>
        <button disabled={!model.canDiscover} onClick={actions.discoverWorkspaces}>Discover workspaces</button>
        <label>Stored workspace<select value={model.workspaceId} onChange={event => actions.selectWorkspace(event.target.value)}><option value="">Choose a workspace</option>{model.workspaces.map(workspace => <option key={workspace.id} value={workspace.id} disabled={!workspace.hasDocuments}>{workspace.id}{workspace.hasDocuments ? '' : ' — no manifest ref'}</option>)}</select></label>
        <button className="primary" disabled={!model.canBrowse} onClick={actions.browseDocuments}>Browse documents</button>
      </div>
    </section></>}
    <div className="request-status"><p role="status" aria-live="polite">{model.status}</p>{model.error && <p role="alert" className="error">{model.error}</p>}</div>
    {model.snapshot ? <section className="browser" aria-label="Document browser" aria-busy={model.busy}>
      {!fullscreen && <aside className="document-sidebar"><h2>Documents <span className="count">{model.snapshot.documents.length}</span></h2><label>Find a document<input type="search" value={model.query} onChange={event => actions.setQuery(event.target.value)} /></label>
        <details className="tree-appearance"><summary>Tree appearance</summary>
          <label>Tree density<select value={model.treeAppearance.density} onChange={event => actions.setTreeAppearance({ ...model.treeAppearance, density: event.target.value === 'compact' ? 'compact' : 'comfortable' })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <label>Tree accent<select value={model.treeAppearance.accent} onChange={event => actions.setTreeAppearance({ ...model.treeAppearance, accent: event.target.value === 'blue' ? 'blue' : event.target.value === 'teal' ? 'teal' : 'default' })}><option value="default">App default</option><option value="blue">Blue</option><option value="teal">Teal</option></select></label>
        </details>
        <AttachableContext target={{ elementId: 'document-tree', label: 'document tree', uiPath: ['Documents', 'Tree'], featureId: 'documents.tree' }}>
          <DocumentTree model={model} actions={actions} />
        </AttachableContext>
      </aside>}
      <article className="document-preview"><header>
        {selected && <div className="reading-navigation">{fullscreen
          ? <button autoFocus onClick={() => actions.setDocumentFullscreen(false)}>← Back to documents</button>
          : <button onClick={() => actions.setDocumentFullscreen(true)}>Open fullscreen</button>}</div>}
        {fullscreen ? <h1>{selected!.path}</h1> : <h2>{selected?.path ?? 'Select a document'}</h2>}
        {model.snapshot.purpose && <p>{model.snapshot.purpose}</p>}<p className="muted">Verified snapshot <code>{model.snapshot.commit}</code></p></header>
        {selected && model.content !== null ? <>
          <div className="document-toolbar"><span className="muted">Read-only snapshot</span>
            <div role="group" aria-label="Document view"><button aria-pressed={model.documentMode === 'source'} onClick={() => actions.setDocumentMode('source')}>Source</button>
              {isMarkdown(selected.path) && <button aria-pressed={model.documentMode === 'markdown'} onClick={() => actions.setDocumentMode('markdown')}>Markdown preview</button>}
            </div>
          </div>
          {model.documentMode === 'markdown' && isMarkdown(selected.path)
            ? <AttachableContext key={`markdown:${selected.id}`} target={documentFeedbackTarget(model, selected, 'documents.markdown-renderer', 'rendered-markdown')}>
              <FeedbackAnnotations target={documentFeedbackTarget(model, selected, 'documents.markdown-renderer', 'rendered-markdown')} showRepresentation={representation => { if (representation === 'source') actions.setDocumentMode('source'); }}><MarkdownDocument content={model.content} /></FeedbackAnnotations>
            </AttachableContext>
            : <AttachableContext key={`source:${selected.id}`} target={documentFeedbackTarget(model, selected, 'documents.source-editor', 'source')}>
              <FeedbackAnnotations target={documentFeedbackTarget(model, selected, 'documents.source-editor', 'source')} showRepresentation={representation => { if (representation === 'rendered-markdown' && isMarkdown(selected.path)) actions.setDocumentMode('markdown'); }}><MonacoDocument key={selected.id} path={selected.path} content={model.content} /></FeedbackAnnotations>
            </AttachableContext>}
        </> : <><p className="document-placeholder" aria-label="Document content">{model.documentId && model.busy ? 'Reading…' : selected && model.error ? 'This document could not be loaded.' : 'Choose a document to read its verified contents.'}</p>
          {selected && model.error && <button onClick={() => actions.selectDocument(selected.id)}>Retry document</button>}</>}
      </article>
    </section> : <section className="welcome"><h2>Your documents, pinned to a snapshot</h2><p>Choose an approved connection and storage repository, discover a workspace, then browse its documents.</p><p className="muted">Manage sign-in and deployment approval in extension connection settings or Alohak native settings. Document contents stay in this tab.</p></section>}
  </main></FeedbackProvider>;
}

import type { InteractionPreview } from './preview';
import './interactions.css';

interface Props {
  inputId: string; json: string; legacy: boolean; preview: InteractionPreview | null; error: string; busy: boolean;
  actions: { setJson(value: string): void; setLegacy(value: boolean): void; review(): Promise<void> };
}
export function InteractionReviewView({ inputId, json, legacy, preview, error, busy, actions }: Props) {
  return <section className="interaction-review" aria-label="Interaction batch review">
    <h2>Review an interaction batch</h2>
    <p>Paste a clipboard export to resolve its pinned targets. This previews requested effects; it does not accept, apply or dispatch them.</p>
    <form onSubmit={event => { event.preventDefault(); void actions.review(); }}>
      <label htmlFor={inputId}>Interaction batch JSON</label><textarea id={inputId} value={json} onChange={event => actions.setJson(event.target.value)} rows={8} />
      <label><input type="checkbox" checked={legacy} onChange={event => actions.setLegacy(event.target.checked)} /> Interpret v1 using the current Documents producer adapter</label>
      <button type="submit" disabled={busy || !json.trim()}>{busy ? 'Resolving pinned targets…' : 'Validate and preview'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {preview && <div aria-live="polite">
      <h3>{preview.ready ? 'Resolved for review — no effects applied' : 'Review needs attention — no effects applied'}</h3>
      <p>Batch: {preview.batchId}</p>
      <ul>{preview.groups.map(group => <li key={group.group}>{group.group}: {group.ready ? 'ready for review' : 'blocked'} · atomic boundary: {group.atomicBoundary}</li>)}</ul>
      <ol>{preview.rows.map(row => <li key={row.item.id}>
        <h4>{row.item.kind} · {row.status}</h4>
        <p>Item {row.item.id}, revision {row.item.version} · {row.group}</p>
        {row.resource && <p>Pinned {row.resource.path} at {row.resource.snapshotCommit}; verified blob {row.resource.blobOid}</p>}
        <ul>{row.issues.map((issue, index) => <li key={index}>{issue.code}: {issue.message}</li>)}</ul>
        <ul>{row.anchors.map(anchor => <li key={anchor.id}>{anchor.id}: {anchor.status}</li>)}</ul>
        <details><summary>Target and original intent</summary><pre>{JSON.stringify({ target: row.target, item: row.item, effectId: row.effectId, itemDigest: row.itemDigest }, null, 2)}</pre></details>
      </li>)}</ol>
    </div>}
  </section>;
}

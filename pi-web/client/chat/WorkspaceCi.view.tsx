import type { CommitCi } from '../../../src/commit-ci';
import type { WorkspaceCiModel } from './WorkspaceCi.hooks';

function checkURL(value: string | undefined) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function CommitCiDetails({ ci }: { ci: CommitCi }) {
  return <details className="chat-ci-detail"><summary>CI: {ci.state} · {ci.repository} · {ci.sha.slice(0, 12)}</summary>
    <p><a href={`https://github.com/${ci.repository}/commit/${ci.sha}`} target="_blank" rel="noopener noreferrer">Commit {ci.sha}</a> · Checked <time dateTime={ci.checkedAt}>{ci.checkedAt}</time></p>
    {ci.state === 'none' && <p>No CI reported for this commit yet.</p>}
    {ci.partial && <p>CI details are incomplete; this is not a confirmed passing result.</p>}
    {ci.errors.map(error => <p key={error}>{error}</p>)}
    <ul>{ci.checks.map(check => <li key={check.id}>{checkURL(check.url) ? <a href={checkURL(check.url)} target="_blank" rel="noopener noreferrer">{check.name}</a> : check.name}: {check.detail} · {check.state}</li>)}</ul>
  </details>;
}
export function WorkspaceCiStatus({ model }: { model: WorkspaceCiModel }) {
  if (!model.enabled) return null;
  return <section className="chat-workspace-ci" aria-label="Latest workspace CI"><details><summary>Latest workspace CI: {model.value?.state ?? (model.error ? 'unavailable' : 'checking…')}</summary>
    <p>Current configured branch heads. These may differ from commits delivered by earlier runs.</p>
    {model.value?.repositories.map(item => <div key={item.path}><p>{item.path} · {item.branch.replace(/^refs\/heads\//, '')}</p>{item.ci && <CommitCiDetails ci={item.ci} />}{item.error && <p>{item.error}</p>}</div>)}
    {model.value && !model.value.repositories.length && <p>No source repositories are configured.</p>}
    {model.value && <p>Updated <time dateTime={model.value.checkedAt}>{model.value.checkedAt}</time></p>}
    {model.error && <p role="status">{model.error} Last successful observation retained when available.</p>}
  </details></section>;
}

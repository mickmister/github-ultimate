import type { WorkflowStatusModel } from './WorkflowStatus.hooks';
import { workflowElapsed, workflowTerminal } from './WorkflowStatus.hooks';

function safeLink(value: string | undefined) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function WorkflowStatus({ model }: { model: WorkflowStatusModel }) {
  if (!model.workflows.length) return null;
  return <section className="chat-workflows" aria-label="Workflows for this conversation"><h2>Workflows for this conversation</h2>
    {model.workflows.map(workflow => {
      const observed = workflow.observation, progress = observed?.progress, result = observed?.result;
      const delivery = result?.delivery?.status ?? progress?.delivery ?? 'pending';
      const analysis = progress?.analysis ?? result?.analysis;
      const runUrl = safeLink(observed?.runUrl), sourceUrl = safeLink(result?.delivery?.status === 'delivered' ? result.delivery.url : undefined);
      const reviewUrl = safeLink(observed?.review?.url ?? progress?.reviewUrl);
      const stale = !workflowTerminal(workflow) && (!workflow.observedAt || model.now - Date.parse(workflow.observedAt) > 30000);
      return <article key={workflow.execution.executionReference} className="chat-workflow" aria-label={`Workflow ${workflow.execution.process}`}>
        <h3>{workflowTerminal(workflow) ? 'Workflow' : 'Active workflow'} · {workflow.execution.process}</h3>
        <p>{workflow.execution.workspace} · {workflow.execution.thread}{observed?.attempt ? ` · Attempt ${observed.attempt}` : ''}</p>
        <p>{observed?.executionState ?? workflow.execution.state} {observed?.conclusion ? `· ${observed.conclusion}` : ''} · Elapsed {workflowElapsed(workflow, model.now)}</p>
        {workflow.observedAt && <p>Updated <time dateTime={workflow.observedAt}>{workflow.observedAt}</time></p>}
        <p>Delivery: {delivery} · Review: {reviewUrl ? 'available' : 'pending'} · Analysis: {workflowTerminal(workflow) && analysis === 'pending' ? 'not completed' : analysis ?? 'not started'}</p>
        {observed?.jobs?.map(job => <div key={job.id}><p>GitHub · {job.name}: {job.status}{job.conclusion ? ` (${job.conclusion})` : ''}{job.steps ? ` · ${job.steps.filter(step => step.status === 'completed').length}/${job.steps.length} steps finished` : ' · Step counts unavailable'}</p>
          {job.steps?.filter(step => step.status === 'in_progress').map(step => <p key={step.number}>{step.name}</p>)}</div>)}
        {observed?.jobsPartial && <p>GitHub job details are unavailable or incomplete.</p>}
        {progress ? <><p>Spec Kit · {progress.currentStep} · Development cycle {progress.cycle} of at most {progress.maxCycles}</p>
          <p>Next: {progress.nextStep}</p>{progress.roles.some(role => role.role !== 'implementer') && <p>Evaluators: {progress.roles.filter(role => role.role !== 'implementer' && role.status === 'completed').length}/3 complete</p>}<ul>{progress.roles.map(role => <li key={role.role}>{role.role}: {role.status}</li>)}</ul></> : <p>Spec Kit detail is unavailable.</p>}
        <p>{runUrl && <a href={runUrl} target="_blank" rel="noopener noreferrer">GitHub run</a>} {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Delivered source</a>} {reviewUrl && <a href={reviewUrl} target="_blank" rel="noopener noreferrer">Review request</a>}</p>
        {(model.offline || model.error || workflow.error || stale) && <p role="status">{model.offline ? 'Offline. ' : ''}{workflow.error ?? (model.error ? 'Status refresh unavailable. ' : '')}{stale ? 'Status may be stale. ' : ''}Last update: {workflow.observedAt ?? 'not observed'}</p>}
      </article>;
    })}
  </section>;
}

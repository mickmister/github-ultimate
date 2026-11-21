import type {OpenReview} from '../../../../hosted/reviews';
import type {ReviewWorkflowProgress} from '../../../../src/review-progress';
import type {WorkspaceScope} from '../../app-hooks/contracts';
import type {StoredReviewArtifact} from '../../app-hooks/reviews';
import {reviewHref} from './ReviewWorkspace';

export function ReviewWorkflowView({scope,response,progress,next,error,busy,storageHref,refresh}:{scope:WorkspaceScope;response:StoredReviewArtifact;progress?:ReviewWorkflowProgress;next:OpenReview[];error:string;busy:boolean;storageHref?:string;refresh():void}) {
  const dispatch=progress?.dispatch??response.dispatch;
  const status=next.length?'A follow-up review is available':progress?.state==='completed'?`Workflow finished: ${progress.run?.conclusion??'outcome unknown'}`:progress?.state==='running'?'Workflow is running':progress?.state==='queued'?'Workflow is queued':'Waiting for verified workflow progress';
  return <section aria-label="Workflow after submission" className="review-summary" data-ui="review-workflow-progress">
    <h2>What happens after your submission</h2>
    <p role="status"><strong>{status}</strong></p>
    <ol>
      <li>Response saved: <code>{response.pin.version}</code>. Your submitted answers remain attached to this exact review.</li>
      <li>Workflow delivery: {dispatch?.state??'unknown'}. {dispatch?.message}</li>
      <li>{progress?.run?<><a href={progress.run.url}>Open the correlated workflow run</a> · {progress.run.status} · {progress.run.conclusion??'no final outcome yet'}</>:<>An accepted dispatch does not prove the workflow has started. {dispatch?.target&&<a href={dispatch.target}>Open Actions</a>}</>}</li>
      <li>{next.length?next.map(item=><p key={item.pin.version}><a href={reviewHref(scope,item)}>Open next checkpoint: {item.request.title}</a></p>):'The agent works until the next human checkpoint, then exits. A new checkpoint will be linked here when it is visible.'}</li>
    </ol>
    {progress?.message&&<p>{progress.message}</p>}
    {progress?.checked_at&&<p>Last checked: {progress.checked_at}. Checks repeat every 30 seconds while this tab is visible.</p>}
    {error&&<p role="alert">Progress check unavailable: {error}. Previous evidence may be out of date; your response remains saved.</p>}
    <button type="button" disabled={busy} onClick={refresh}>{busy?'Checking workflow…':'Refresh workflow progress'}</button>
    <p>You do not need to resubmit this response to check progress. Workflow completion is separate from QRSPI phase approval.</p>
    <details><summary>Agent transcripts and diagnostics</summary><p>Agent events and native session records are stored in private S3. This panel does not yet link the run to those objects. Use the approved extension S3 connection to inspect stored evidence; no transcript is inferred from a GitHub run status.</p>{storageHref&&<p><a href={storageHref} target="_blank" rel="noopener noreferrer">Open private S3 object browser</a>. This requires a separately configured and approved S3 connection; CI credentials are not passed to this page.</p>}</details>
  </section>;
}

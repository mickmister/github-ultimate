import {useEffect, useState} from 'react';
import type {OpenReview} from '../../../../hosted/reviews';
import type {ReviewWorkflowProgress} from '../../../../src/review-progress';
import type {WorkspaceScope} from '../../app-hooks/contracts';
import type {ReviewsModuleV1, StoredReviewArtifact} from '../../app-hooks/reviews';
import {ReviewWorkflowView} from './ReviewWorkflow.view';

export function ReviewWorkflow({scope, review, response, service}: {scope:WorkspaceScope; review:OpenReview; response:StoredReviewArtifact; service:ReviewsModuleV1}) {
  const [progress, setProgress] = useState<ReviewWorkflowProgress>();
  const [next, setNext] = useState<OpenReview[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false, timer:ReturnType<typeof setTimeout>;
    async function check() {
      if (document.visibilityState === 'hidden') { timer=setTimeout(check,30000); return; }
      setBusy(true);
      let finished=false;
      try {
        const [status, listing]=await Promise.allSettled([
          service.progress ? service.progress(scope,response) : Promise.resolve<ReviewWorkflowProgress>({state:'unknown', checked_at:new Date().toISOString(), dispatch:response.dispatch, message:'Live workflow progress is not available from this host.'}),
          service.list(scope),
        ]);
        if(cancelled)return;
        const value=status.status==='fulfilled'?status.value:undefined;
        if(value)setProgress(value);
        setError([status,listing].filter(result=>result.status==='rejected').map(result=>(result as PromiseRejectedResult).reason).map(cause=>cause instanceof Error?cause.message:String(cause)).join('; '));
        const followups=listing.status==='fulfilled'?listing.value.requests.filter(item=>item.request.status==='published' && item.request.previous_request===review.request.request_id
          && item.request.workspace===review.request.workspace && item.request.thread===review.request.thread && item.request.process?.id===review.request.process?.id
          && item.request.process?.workspace_ref===review.request.process?.workspace_ref):undefined;
        if(followups)setNext(followups);
        finished=value?.state==='completed' && (value.run?.conclusion!=='success' || Boolean(followups?.length));
      } catch(cause) { if(!cancelled)setError(cause instanceof Error?cause.message:String(cause)); }
      finally { if(!cancelled){setBusy(false);if(!finished)timer=setTimeout(check,30000);} }
    }
    void check();
    return()=>{cancelled=true;clearTimeout(timer);};
  },[scope,review,service,response.pin.version,response.pin.resource,refresh]);
  const storageHref=typeof window==='undefined'?undefined:new URL('../s3.html',window.location.href).href;
  return <ReviewWorkflowView scope={scope} response={response} progress={progress} next={next} error={error} busy={busy} storageHref={storageHref} refresh={()=>setRefresh(value=>value+1)} />;
}

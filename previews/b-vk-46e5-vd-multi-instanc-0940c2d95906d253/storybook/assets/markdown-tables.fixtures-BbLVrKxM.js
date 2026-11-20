const e=`# Workspace lifecycle

| Lifecycle stage | Required action | Publication evidence | Recovery behavior |
| --- | --- | --- | --- |
| Publication checkpoint | Verify the exact document revision before publishing the review and recording its immutable receipt. | The receipt includes the workspace snapshot and the selected document version for later inspection. | Restore the independently verified checkpoint and retain any newer local work before retrying publication. |
| Concurrent changes | Reconcile compatible changes while preserving the original review and its submitted answers. | Keep source references and publication receipts available when the workspace is opened on another device. | Report overlapping edits without silently selecting a winner or discarding either author's work. |

| Identifier | Explanation |
| --- | --- |
| workspace_ref | A stable identity for the workspace rather than the current branch name. |
`;export{e as m};

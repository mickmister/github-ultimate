# On-demand workflows from browser Pi

Browser Pi's `codemode` tool exposes the shared MCP interface from
`src/workflow-interface.ts`: `workflows_list`, `workflow_start`, `workflow_status`.
Each definition contains input/output schemas and behavior. Kody can implement the
same interface with its own credential and transport adapter; Pi does not use Kody.
This module defines the interface, not a separately deployed MCP server.

## Calling the tools

```js
const catalog = await tools.workflows_list({});
text(catalog);
```

Discovery uses the conversation's selected nugs workspace, or an explicit
`{workspace:{repository,workspace}}` scope. It reads the pinned authored manifest
and returns source member paths/commits and authorized connection references.
It does not read or restore Dolt/Beads. Ambiguous storage connections need an
explicit connectionId; no global/default workspace is inferred. An unassigned
conversation can still discover supported workflow types. Retained receipt
discovery requires the selected or explicitly supplied original workspace scope.

The designated browser parent agent supplies task text, acceptance criteria,
member and baseCommit, stable thread/process identities, an opaque connectionRef,
and explicit source/publication scope to `workflow_start`. Request version 2 has
no mandatory tracker and no caller setup/test arrays. The workflow repository must
already have a trusted identity for the selected workspace. An unsupported
workspace fails; dispatch is not implicit onboarding. The first supported workflow
is Spec Kit's bounded implementer → parallel two reviewers/tester method, max four
cycles. Acceptance does not integrate source or create a PR.

## Effects and recovery

- The transcript's tool-call intent is saved before the launch capability runs.
- The privileged host checks document origin/path, original authenticated actor,
  installation, repository visibility and Actions write access.
- Target repository/workflow/ref are host-owned. The broker snapshots the engine
  commit and passes it to the workflow; a branch race fails before source work.
- The broker serializes its local writers and persists dispatch-unknown intent
  before POST. Repeat identical inputs return the same receipt; changed inputs
  with the same workspace/thread/process conflict. Unknown POST outcomes never
  trigger automatic replay. This is not distributed exactly-once delivery.
- A failed/cancelled QuickJS script cannot roll back an already-started workflow.
  `workflows_list` exposes workspace-scoped retained receipts even if the script
  lost its output. Supply the original workspace explicitly after moving a chat.
- Restoring an unresolved tool call adds an explicit uncertainty observation;
  it never replays that call. Inspect the retained executionReference instead.
- Receipts currently live in the authenticated device host's connection storage.
  Page reload and host restart preserve them. Cross-device receipt discovery is
  not implemented; a different host must not invent replacement work.

`workflow_status` associates a run using exact title, actor, event, branch,
expected engine commit and launch window. Multiple matches remain ambiguous.
After association it reads the exact run ID. A green run still returns unknown
candidate acceptance until the original workspace's pinned report is read and its
run/attempt, candidate, three distinct evaluator roles and required-check result
validate. Pass reportWorkspace when the conversation is no longer in that scope.

Runtime payloads and native/OTLP evidence remain private S3; compact reports use
existing nugs documents. No Actions artifact handoff or extra scheduler is added.
Detailed in-flight methodology progress and human Continue/New-thread controls
remain separate UI work; Actions status is not invented methodology progress.

## Deployment and verification

Install the updated extension/native host as well as refreshing Pi Web. Older
hosts do not implement the new workflow operations. GitHub access uses the existing
host-owned broker, including the native GitHub connection path, not the Pi-only
inference/S3 transport. Model and repository content never receive credentials.

`pnpm run test:workflows` runs actual Pi → QuickJS worker → privileged Connections
broker in Chromium and WebKit. Inference, S3 and GitHub endpoints are fixtures;
it checks launch journaling, receipt persistence, script failure after dispatch,
restore/status and no credential exposure. Unit tests cover authority denial,
lost POST response, duplicate/conflicting inputs, ambiguous runs and invalid
candidate acceptance. Hosted live-inference acceptance is recorded separately.

Production builds emit hashed worker/WASM assets under Pi Web's existing payload
budget. Workflow tools are available only to the browser parent agent; hosted
development workers retain their role-scoped source/evidence tools without launch
or delegation capabilities.

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

The current conversation's canonical `{repository,workspace}` identity is injected
into the system context and codemode tool description before each invocation.
The URL scope must match durable catalog membership. It is fixed for that invocation;
a later cross-device move blocks fresh workspace-specific effects until refresh.
Launches must use that workspace and a configured source branch member.
Host credentials, grants, actor and installation checks remain authoritative.

Discovery uses the conversation's selected nugs workspace, or an explicit
`{workspace:{repository,workspace}}` scope. It reads the pinned authored manifest
and returns source member paths/branches and authorized connection references.
It does not read or restore Dolt/Beads. Ambiguous storage connections need an
explicit connectionId; no global/default workspace is inferred. The core API can
discover supported workflow types without a selected workspace. The normal Unassigned UI is
migration-only and does not run inference. Retained receipt
discovery requires the selected or explicitly supplied original workspace scope.

The designated browser parent agent supplies task text, acceptance criteria,
member, stable thread/process identities, an opaque connectionRef,
and explicit source/publication scope to `workflow_start`. Request version 2 has
no mandatory tracker and no caller setup/test arrays. The workflow repository must
already have a trusted identity for the selected workspace. An unsupported
workspace fails; dispatch is not implicit onboarding. The first supported workflow
is Spec Kit's bounded implementer → parallel two reviewers/tester method, max four
cycles. New runs deliver the exact approved candidate through a non-force configured
branch update or a PR, plus a bounded CI-agent-authored initial review. Deeper native
and OTel analysis follows in another job of the same Actions run and enriches the
review. Optional `request.delivery:"pull-request"` selects PR delivery explicitly.
The old `publishCandidate` argument is optional compatibility data, not required
ordinary caller boilerplate.

The caller does not supply a source commit. At startup CI resolves the latest
remote commit of every configured repository branch and retains the captured
source vector. That vector and the resulting candidate remain exact execution
evidence even when branches advance. Old observed branch commits in historical
workspace manifests do not select new work; current manifests omit them. Every
workspace source member selects a repository branch. CI checks out those branches
and records their resolved commits as execution evidence, not as manifest fields.

## Effects and recovery

- Pi owns normal tool → result → assistant scheduling. Tools run sequentially.
  Awaited Pi message-end subscribers save tool intent before execution and completed
  results before the next inference request. Checkpoint writes are serialized. A
  required save failure aborts the invocation and requires explicit save recovery.
- Each workflow's parsed identity/digest is also saved as `workflow_intents` before
  the host is called. Receipts are separately saved as `workflow_executions`, with
  their originating storage repository, before codemode proceeds. A failed script
  or absent final assistant answer does not erase these references.
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
- The host retains its effect ledger; canonical S3 checkpoints share intents and
  receipts across authorized devices. `workflows_list` returns conversation receipts
  and can recover a lost reply from the original host's matching intent/receipt.
  A different host can inspect a shared receipt with the same authenticated GitHub
  actor/installation and Actions read access. It revalidates the exact run and does
  not import caller-supplied receipts into its launch-authority ledger.
- A saved attempted identity with no receipt blocks redispatch, including on a new
  device. Original-host discovery may recover it; absence is not proof of failure.
  Restored legacy uncertain tool calls without structured intent prevent new launches
  in that conversation. Read-only inspection remains available.
- Stale continuations merge current effect metadata before saving/launching, without
  merging transcripts. This is not a distributed lock or globally exactly-once
  dispatch guarantee; simultaneous writers and unpublished/lost knowledge still
  require explicit uncertainty handling.

Engineering defaults per explicit invocation are 12 model requests, 24 Pi tool
calls, 64 nested capabilities, five minutes elapsed and 512 KiB of transcript output.
Reaching a bound saves an interrupted state with a reason; **Continue interrupted
turn** begins a fresh bounded invocation from saved results. Stop propagates through
Pi and the QuickJS worker; an external operation already attempted may finish, and
its returned receipt is still checkpointed. Reload never automatically continues.
Pause-policy and inspect/branch/takeover product alternatives remain open in
`task-93j.3.14`; these defaults are not a recorded product-policy decision.

`workflow_status` associates a run using exact title, actor, event, branch,
expected engine commit and launch window. Multiple matches remain ambiguous.
After association it reads the exact run ID. A green run still returns unknown
candidate acceptance until the original workspace's pinned report is read and its
run/attempt, candidate, three distinct evaluator roles and required-check result
validate. Pass reportWorkspace when the conversation is no longer in that scope.

Runtime payloads and native/OTLP evidence remain private S3; compact reports use
existing nugs documents. No Actions artifact handoff or extra scheduler is added.
Pi chat renders automatically polled workflow cards from the calling conversation's
durable receipts. Visible active cards refresh approximately every10 seconds; local
elapsed-time ticking needs no model turn. Visibility changes pause/resume polling,
errors back off, and completed runs stop. Multiple runs remain distinct, and restore
uses the original actor/installation receipt, including read-only recovery on another
authorized device. A conversation switch cancels its pending view requests.

Actions job steps retain their individual states and actual finished/total counts.
In-flight Spec Kit cycle/role/current-next detail comes from a compact GitHub check
created by the runtime's GitHub Actions identity, bound to the exact engine SHA,
workspace/thread/process and run attempt. The check is a neutral observation, never
approval. Its absence or denied checks-read access leaves details unavailable;
it does not invent methodology progress or hide independent Actions status.
Private native sessions and OTel are not downloaded on each poll.

Delivery, initial review readiness, analysis and whole-run conclusion are separate.
Source/review links appear before long after-analysis finishes. Stale/offline or
revoked-access views retain the last observation with an explicit notice. Standalone
development has no full QRSPI phase binding, so the UI does not infer phase approvals
from job completion. Broader QRSPI process projection and human Continue/New-thread
controls remain separate supported-adapter work under task-clh.

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

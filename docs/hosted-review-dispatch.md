# Hosted QRSPI review delivery

## Validation ownership

Review/form business schemas are owned by the deployed hosted app and the
receiving workflow, not installed extension/native releases. Before saving, the
hosted app validates the exact request/form pins, answers, comment category,
current withdrawal state and process config. The receiving workflow independently
revalidates the pinned submission and approval scope before admitting work. VD
notifications likewise instruct the receiving agent to read and validate exact
pins before continuing; CLI `review ingest` validates before updating Beads.

The installed writer uses `src/review-io.ts`: a small projection of storage
identity/mode and pinned delivery routing. It enforces authenticated reviewer,
approved caller/connection/repository, bounded payload, allowed resource paths,
immutable submissions, conditional non-force writes and verified readback. It
does not load form bodies or validate answers, question types, request metadata
or review lifecycle semantics. Future metadata such as `created_at` is irrelevant
to this IO contract. New payloads are saved byte-for-byte, including unknown
fields. Retry comparison recognizes older JSON formatting/property order without
rewriting immutable resources or ignoring changed unknown fields.

Routing remains credential policy: process IDs and VD destination IDs come from
the immutable request selected by exact pin, never an arbitrary page-supplied
dispatch URL. Installed hosts retain configured trusted destinations and effect
limits. A saved receipt or accepted notification is not semantic approval.
Installing the boundary correction is a one-time migration; subsequent domain
metadata changes must not require another installed release.

The existing review-request schema accepts optional `process`:

```ts
{ kind: 'qrspi', id: string, workspace_ref: string, thread_id: string, config: ReviewPin }
```

`thread_id` must equal the request's authoritative `thread`. The config is read using the same verified workspace snapshot reader as all other pinned resources. Old requests remain valid. The broker derives the process exclusively from the immutable request selected by the response's exact request version/snapshot, never from a page-supplied dispatch payload.

## Trusted routing / deployment

`src/review-dispatch.ts` is the privileged host default: repository `mickmister/gh-agentic-workflows`, workflow `qrspi-process.yml`, ref `vk/46e5-vd-multi-instanc`. Fork extension bootstraps can supply `ReviewDispatchHost` as the final `Connections` constructor setting. This is not a hosted protocol operation. No reviewed document can select a repository, ref, workflow, or credential connection.

By default the authenticated storage connection must also expose the configured source repository through its selected installation and user, with Actions write permission. For separate storage/source Apps, the trusted bootstrap must explicitly set `sourceConnectionId`. That connection must be granted to the original hosted origin/subpath, authenticated as the **same GitHub user**, installed, and expose the configured source repository with Actions write permission. Missing routing returns a saved receipt with a concrete failure, never a fallback to unrelated credentials. No extension settings UI for this trusted cross-App routing is introduced in this slice.

Modern Connections discovery advertises `qrspiProcessReview` in addition to generic `reviewWrite`. Hosted saves resolve the exact immutable request and require both capabilities for process-bound drafts/responses before sending any privileged write. Non-process reviews still require only `reviewWrite`. This capability is compatibility evidence, not Actions permission or workflow admission. A sole root-level `unrecognized_keys: ["process"]` broker error is translated into extension/Alohak broker update and page reload guidance; other validation failures remain visible.

Process-less requests can include `response_effect` for return-to-agent VD notification.
An older installed broker may advertise `reviewWrite` but reject that field when
reading the pinned request. The hosted client translates a root-level unknown-key
error limited to the pinned request's `response_effect` (and `process`, if present)
into broker-update and retry guidance. It retains the same answers, request pins
and response identity; it does not remove routing metadata or relax validation.
Compatible brokers continue to work with their existing capabilities. Updating
the hosted page alone cannot replace an older installed extension/Alohak broker.

Answer/progress recovery is tab-session storage, scoped to exact connection, installation, repository, workspace, request version/snapshot and authenticated reviewer. It retains the pending ID and a SHA-256 payload fingerprint for explicit retry, never automatically submits, and caches no document body, comment/quote, or credential. At most eight entries of 128,000 characters each are retained, expiring after seven days. Feature intake uses its independent existing category; recovery never clears it. Blocked/full storage leaves in-memory state and warns before a save; reload recovery then cannot be guaranteed. Authored content comments are not restored by this local mechanism (remote drafts remain supported).

Production deployment requires an updated installed broker and hosted webapp. No installed-extension acceptance, workflow start, or real human response has been observed by this implementation lane.

## Review inbox entry

The inbox is workspace-scoped. A link can provide both `repository` and `workspace`
at `#/reviews?repository=owner%2Fstorage&workspace=workspace-handle`; the user still
needs an approved broker connection. Repository/workspace discovery uses the
integration branch's storage picker: a single available choice is selected
automatically, and multiple results are offered in dropdowns. Select Open review
inbox when ready. Missing connections and empty discovery have explicit guidance
instead of an unexplained disabled button; Reload choices retries discovery.

The default **Only waiting for my response** filter includes published requests
not fully answered by the authenticated reviewer at their current request revision.
Other reviewers' responses cannot satisfy this personal filter. Turn it off to
include responded, draft and withdrawn requests. It is not an assigned-reviewer
queue or a global cross-workspace inbox.

## After a process response is submitted

The post-submission panel shows saved-response identity, delivery evidence,
exactly correlated Actions status and same-process follow-up review links. It
checks every 30 seconds while visible; refreshing never resubmits a response.
Successful process form submission exits form Zen mode and brings the workflow
panel into view. Non-process review behavior is preserved.

Live lookup requires the `qrspiWorkflowProgress` broker capability and an updated
engine run name containing the exact immutable response blob as a delimited
token. The broker requires its retained same-reviewer delivery receipt, current
storage/source access and trusted configured workflow/ref. A similarly named
process or the latest run is insufficient. Multiple matches remain ambiguous.
Older runs/brokers and unavailable evidence remain unknown, not failed or complete.

The extension already brokers S3 list/read/upload and the preview publishes
`../s3.html`. That is a generic bounded object browser, not an integrated agent
transcript viewer. Runtime Pi events/native/output/result bundles stay private;
the review panel does not yet bind a run to those object keys. S3 connections and
origin/subpath grants are separately configured; hosted pages do not inherit CI
credentials. See [S3 connections](s3-connections.md) for current bounds and setup.

## Engine wire contract

After immutable submitted response persistence and byte-for-byte readback, the broker sends Actions dispatch inputs:

- `workspace`: request `workspace` (readable Documents handle).
- `process`: request `process.id`.
- `bead`: request `bead_id`.
- `response`: JSON containing **only** `{resource,version,snapshot,reviewer}` from verified persistence.

No new engine inputs were added. `workspace-context` must be resolved by the engine's trusted pilot repository-variable fallback; it is not taken from reviewed content. The engine must validate workspace_ref, thread, exact config/request/form pins, reviewer/scope, and durable duplicate admission. A dispatch accepted by GitHub does not prove the workflow started or a QRSPI phase completed.

Drafts never dispatch. Delivery failure returns the saved response receipt plus compact dispatch evidence. The broker retains first-readback receipts and pending/failed/dispatched evidence in its credential store, not Documents. Identical response retries reconcile the existing bytes and retry delivery without committing answers again. Delivery admission remains the engine's responsibility. Reloaded UI artifacts show delivery unknown until reconciled; they do not manufacture workflow status. Receipt links identify exact Git snapshots and blob versions.

## Methodology presentation

The production review session reads pinned config/artifacts and optional current resources through `ReviewsModuleV1` and `ReviewReader`/`WorkspaceReader`. It shows authored route/pipeline/phase/status/approval metadata, exact pins, check time, missing/error/loading/current-versus-stale evidence. Historical approved metadata is not overwritten by absent current metadata. This is evidence presentation, not a second scheduler or task-status database.

## Feature feedback intake

Content and feature comments cannot be combined into submitted content responses. Hosted application and receiving-workflow domain validation reject feature comments in `review-response`, regardless of process presence. The production review UI excludes feature comments from remote content drafts/responses and keeps feature drafts in an independent tab-persisted intake queue; legacy remote feature drafts are migrated to that queue. Feature-only content submission is blocked.

The review comment queue submits Content through **Submit review feedback**, including current form answers, and clears only successfully saved content versions. Failures, concurrent edits, and unsubmitted items remain queued. The empty floating Comments control is hidden. Feature intake continues to use its separate clipboard export for agent-chat intake/discovery. Outside review sessions, Content retains its own clipboard export. Feature intake explicitly says destination workspace/thread **UNKNOWN**, marks viewed resources as reproduction context, and says copied is **not delivered**. It never dispatches a content process. Resolving a real product destination remains downstream intake/discovery work, not a claimed delivery.

# Hosted QRSPI review delivery

The existing review-request schema accepts optional `process`:

```ts
{ kind: 'qrspi', id: string, workspace_ref: string, thread_id: string, config: ReviewPin }
```

`thread_id` must equal the request's authoritative `thread`. The config is read using the same verified workspace snapshot reader as all other pinned resources. Old requests remain valid. The broker derives the process exclusively from the immutable request selected by the response's exact request version/snapshot, never from a page-supplied dispatch payload.

## Trusted routing / deployment

`src/review-dispatch.ts` is the privileged host default: repository `mickmister/gh-agentic-workflows`, workflow `qrspi-process.yml`, ref `vk/46e5-vd-multi-instanc`. Fork extension bootstraps can supply `ReviewDispatchHost` as the final `Connections` constructor setting. This is not a hosted protocol operation. No reviewed document can select a repository, ref, workflow, or credential connection.

By default the authenticated storage connection must also expose the configured source repository through its selected installation and user, with Actions write permission. For separate storage/source Apps, the trusted bootstrap must explicitly set `sourceConnectionId`. That connection must be granted to the original hosted origin/subpath, authenticated as the **same GitHub user**, installed, and expose the configured source repository with Actions write permission. Missing routing returns a saved receipt with a concrete failure, never a fallback to unrelated credentials. No extension settings UI for this trusted cross-App routing is introduced in this slice.

Production deployment requires an updated installed broker and hosted webapp. No installed-extension acceptance, workflow start, or real human response has been observed by this implementation lane.

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

Content and feature comments cannot be combined into submitted content responses. Broker validation rejects feature comments in `review-response`, regardless of process presence. The production review UI excludes feature comments from remote content drafts/responses and keeps feature drafts in an independent tab-persisted intake queue; legacy remote feature drafts are migrated to that queue. Feature-only content submission is blocked.

The supported existing app-intake boundary here is clipboard export for agent-chat intake/discovery, not an invented remote product workspace. Content and Feature have separate export/clear controls, with same-category grouping preserved. Feature intake explicitly says destination workspace/thread **UNKNOWN**, marks viewed resources as reproduction context, and says copied is **not delivered**. It never dispatches a content process. There is no newly invented feature delivery server, approval gate, or Documents runtime queue. Resolving a real product destination remains downstream intake/discovery work, not a claimed delivery.

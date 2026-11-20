# Browser Pi agent proof of concept

The hosted app's `app/#/agent` screen and standalone `pi.html` page run
**`@earendil-works/pi-agent-core` 1.5.2**. The standalone page retains the initial
read-only transport proof; the app screen adds a persistent scratch workspace.
The extension owns inference HTTP requests, optional secret headers, GitHub tokens
and S3 SigV4 signing. There is no agent backend. This is an initial runnable slice
of [issue #7](https://github.com/mickmister/github-ultimate/issues/7), not completion
of its broader workspace/document/streaming milestone.

The React UI is project-owned. Official Pi core/AI/codemode/schema packages power
the runtime; the official `pi-web-ui` package uses mini-lit web components and is
not used here. Install/reload the updated extension and hosted page together;
connection discovery reports an actionable upgrade error for an older broker.

## Try it

### Accepted next slice (2026-11-19)

The user accepted an Agent screen inside the hosted app, retaining the standalone
POC for focused testing. Scratch starts from a selected GitHub repository directory
at an explicit pinned commit, or an empty workspace. The milestone is import,
edit with codemode, inspect diff, create a scratch commit, then restore messages
and workspace from S3. GitHub branch publication follows that round trip.
These are decisions from this session's chat, not a submission or replacement of
the historical `browser_pi_poc_decisions_v1` review form. Implementation and
verification evidence are tracked separately in `task-alc`.

### Hosted Agent screen

Open **Agent** from Documents navigation, or `app/#/agent` within the same branch
preview. Navigation preserves the selected workspace context and preselects its
GitHub connection/repository. Load and choose approved inference, GitHub and S3
connections; their grants must include the app directory, not just `pi/`.

Choose **New empty workspace**, or enter a source repository, full 40-character
commit SHA and directory (empty means root), then **Import pinned directory**.
The broker checks the original page grant, current GitHub user/installation and
repository access before pinned Git reads. Initialization loads the commit and
immediate directory metadata through GraphQL, not file contents or a recursive
index. Trees and requested text blobs are hash-verified. Large/binary files,
symlinks and submodules remain discoverable without blocking workspace creation;
text tools do not follow symlinks or edit submodules. Individual text reads are
limited to 128 KiB. The local edit overlay permits 100 files / 512 KiB; these are
edit limits, not a limit on the upstream repository's file count or total size.

The agent gets `codemode` and a separate `git_commit` tool. Codemode offers
`list_files`, `find_files`, `read_file`, `search`, `write_file`, `delete_file`, `apply_patch`,
`git_status`, `git_diff` and `git_log`, scoped to this session's scratch tree.
Arguments are validated in their implementations, not just declared as schemas.
Scripts use `await tools.read_file({path: "README.md"})` and `text(value)`.
The UI also exposes script execution, diff, commit and history for direct testing.

`list_files({path:"."})` is shallow. `find_files` traverses metadata under a path
and matches workspace-relative `*`, `**`, `?` globs, with result pages and up to
50 directories per call. `read_file` returns raw text starting at `startLine`
(default 1), up to `lineCount` lines (default 200, max 500), and `nextLine`.
Content search reads candidates on demand: at most 64 text files / 512 KiB / 100
matches per call, with `complete`, skipped-file reasons, continuation and remaining
directories. Incomplete results do not establish that a symbol is absent.
Status uses identities; diff fetches missing before-images only for changed files.

`@earendil-works/pi-codemode/portable` 1.5.2 runs QuickJS/WASM inside a dedicated
browser Worker. Its WASM is self-hosted and gzip-decompressed locally. The VM
receives scratch capabilities, no credentials or ambient network/shell/DOM. Each
script uses a cloned tree and applies it only on success at the original revision.
Failure, cancellation, timeout or concurrent change discards the overlay. The VM
has a 32 MiB heap cap and 20,000 interrupt polls. Bounded async reads cross a typed
Worker/host bridge; credentials and arbitrary network access never enter the VM.
Execution has a 60-second deadline and a 90-second outer worker timeout, with at
most 150 host object reads per execution. Script source is limited to 32 KiB.

Scratch commits use native Git blob/tree/commit encoding, with hashes checked
against system Git in tests. They version the entire scratch tree and form an
independent repository: importing a directory records its upstream pin as
provenance, without pretending that the partial tree is a full upstream checkout.
Scratch author identity is `Browser Pi <scratch@localhost>`. There is no GitHub
push, branch mutation or PR creation in this slice.
Unchanged blobs/subtrees retain their upstream object IDs without downloading
their contents. Changed-path ancestor trees and local objects describe the full
selected tree; this is a lazy repository, not a self-contained offline export.

The S3 checkpoint contains base provenance/tree metadata, local edits/deletions,
history and HEAD alongside messages. Untouched file contents remain lazy after
restore and require GitHub access when first read. Legacy fully materialized
checkpoints remain readable. This single object is the consistency boundary; no separate manifest can point
to partially uploaded files. History is limited to 30 commits / 2 MiB serialized
scratch state, within the unchanged 4 MiB total checkpoint cap. Successful manual
scripts and commits save immediately; agent tools save with their settled prompt.
Restore checks file paths, bounds and Git object integrity before enabling the
session. Old transcript-only checkpoints remain readable by the app; the standalone
page refuses workspace-bearing checkpoints rather than silently dropping files.

Phone, tablet and desktop have separate views above the same session controller.
Drafts, source selection and operation identity stay above presentation switches.

### Standalone transport POC

1. `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run hosted:build`.
   Load `dist/` as an unpacked Chromium extension. `pnpm run pi:build` rebuilds
   only the isolated POC page for iteration.
2. In the extension's **connections.html**, add an inference connection: full
   Chat Completions URL (including `/v1/chat/completions`), model ID and optional
   JSON string-valued headers, for example `{"Authorization":"Bearer …"}`.
   Empty headers work for unauthenticated inference. HTTPS is required except
   HTTP localhost/127.0.0.1. Redirects and URL query credentials are unsupported.
3. Configure an authenticated GitHub App connection and select its installation.
   Configure an S3 connection with read/list/upload enabled and **overwrites off**.
   Use a dedicated private session prefix.
4. Independently approve the hosted page's origin and directory subpath on all
   three connections. Approve endpoint host permissions when prompted. Reload
   the hosted page after grants. Serve `hosted-dist/` over HTTPS or HTTP loopback,
   or use the published branch's `pi.html` beside `index.html`.
5. Load approved connections, explicitly choose each connection, and select
   **New session**. Try “List my repositories” or “Read owner/repo”.
6. Retain the session UUID. On a new page/device independently configure and
   authenticate equivalent connections, enter that UUID, list checkpoints,
   select one and restore. No credentials or local connection UUIDs are copied.

## Runtime and transport

`hosted/pi-agent.ts` constructs the real Pi Agent with typed read-only GitHub tools:
`github_graphql`, `github_repositories` and `github_probe` (repository metadata and default-branch
commit identity). Tools bind the selected GitHub user and installation, which the
broker checks before use. The existing repository authorization is rechecked.
The hosted Agent screen supplies its additional scratch tools to this same runtime.

`github_graphql(query, variables)` accepts exactly one query operation, including
fragments/aliases. The extension parses its AST with pinned `graphql@16.11.0`,
rejects mutations/subscriptions/multiple operations before HTTP, and supplies the
fixed endpoint and saved credentials. Limits: 32 KiB query/variables each, 4,000
tokens, 500 fields, selection depth 20, 2 MiB response and the existing GitHub
timeout/cooldown. Partial GraphQL data/errors remain explicit. It can query any
repository accessible through the approved connection; scratch edits still target
only the selected workspace. The existing GitHub App user token can have Contents
write permission for other app features; query AST enforcement is the tool's write
boundary, not a claim that this credential itself has been downgraded.

The hosted screen also exposes `beads_query` for the same selected workspace as
Kanban (open Agent from workspace navigation). It loads the verified read-only
browser engine on first use. `list`, `show`, `ready`, `blocked` and explicit
`refresh` are allowlisted. TypeScript filters IDs/text/status/assignee/label/type,
sorts by priority/ID and returns at most 50 issues / bounded text with continuation.
Native `ready` and `blocked` retain dependency semantics. Results carry workspace
and Git/Dolt snapshot IDs; used snapshot/serving-pack pins survive session restore
until explicit refresh. A Beads snapshot is independent of the source-code commit.

`hosted/pi-transport.ts` implements Pi's `StreamFn` using a **non-streaming**
OpenAI-compatible Chat Completions JSON reply. It preserves assistant tool calls,
call IDs and results across subsequent model requests. Pi performs argument
validation and the tool loop in the page. Text/tool events are displayed after a
whole model message arrives; this does not provide incremental token streaming.
The adapter deliberately supports only text and function tools. Thinking, images,
dynamic prompt sections, Responses and Anthropic wire formats are unsupported.

The extension's inference connection stores the full endpoint and headers in
extension-origin IndexedDB. List/discovery responses expose only name, local ID,
revision, model and path grants. Hosted requests supply only messages/tools and a
request ID: they cannot choose URL, headers, model, method, redirects or cookies.
The model comes from settings, `stream=false`, `max_tokens=4096`. Requests are
limited to 1 MiB, responses to 2 MiB, duration to 90 seconds and concurrency to two.
Stop aborts inference; grant removal aborts active requests and blocks late replies.
Each prompt has a 12-model-request cap. Prices are unknown, not measured as zero.

## S3 session contract

`hosted/pi-session.ts` stores versioned UTF-8 JSON under
`<approved-prefix>/pi-sessions/<session-uuid>/<timestamp>-<uuid>-<sha256>.json`.
The actual prefix is concatenated with its existing trailing slash. Each object
contains the session/checkpoint/parent, creation time, versioned runtime identity,
portable binding and completed Pi user/assistant/tool transcript. Tools/system
instructions are rebuilt from this application, not executed from storage.
The app screen additionally persists its optional versioned `scratch` state in
the checkpoint object.
The dedicated `s3Checkpoint` operation generates a fresh key in the broker and
binds it to the payload SHA-256. For standard `*.backblazeb2.com` endpoints it uses
ordinary signed PUT, requires a non-null returned version ID and verifies that
exact version by GET. Backblaze checkpoint listing uses paginated ListObjectVersions;
restore references contain key plus encoded version ID. Other endpoints retain
conditional create-only PUT; returned version IDs are used when available.
The generic S3 upload operation retains its existing no-overwrite contract.
Every save verifies readback and restore verifies the content hash. The session limit is 4 MiB (the general
broker transfer limit remains 8 MiB).

Portable bindings compare GitHub App/user/installation, inference model, S3
endpoint/bucket/prefix/region/addressing, selected Beads workspace when present,
and the runtime/schema identity. The user
explicitly maps these to independently authorized local connections on restore.
The endpoint and inference header secrets are never serialized. Identical model
names at different inference providers can be explicitly mapped; provider profile
identity/migration is a follow-up decision, not an implicit credential transfer.

Checkpoints are created for an empty new session and after each **settled prompt**.
Reload restores a selected exact checkpoint and never replays tools automatically.
Unresolved tool calls or unmatched/duplicate results fail restoration. A save
failure retains in-memory state and blocks further prompts until Retry session
save succeeds. Closing the page during an unsaved prompt can lose that prompt;
per-turn crash journaling is not implemented. Stop cancels the active model request;
an already issued read-only GitHub request may finish but no write is involved.

Two writers create independent children of the same parent; there is no mutable
latest pointer, lock, hidden last-write-wins merge or cross-storage transaction.
Listing is paginated and checkpoint selection is explicit. Retention, compaction,
cross-device running-stream handoff and interrupted-run recovery remain open.

## Verification and scope

- `pnpm exec vitest run tests/inference-connections.test.ts tests/browser-pi.test.ts`
  exercises the real Pi runtime, tool continuation, UTF-8 persistence, fresh local
  IDs on restoration, branching, identity mismatches, malformed replies, bounds,
  cancellation and access revocation.
- `pnpm run build && pnpm run pi:build` then
  `pnpm exec playwright test tests/browser/pi-agent.spec.ts` loads the packaged
  Chromium extension and actual bundled hosted page with mocked remote services.
  It verifies private inference headers, GitHub auth, SigV4/Backblaze versioned requests,
  save/readback, reload/restore/continue and revoked inference access.
- `pnpm run check`, `pnpm run build:safari`, `pnpm run hosted:build` verify type and
  browser-target packaging. License notices are derived from bundled packages;
  Pi's npm distributions omit their license file, so the MIT text is retained from
  upstream `earendil-works/pi` tag `v1.5.2` in `licenses/pi-MIT.txt`.

These mocks prove the local architecture and serialization, not successful access
to a user's live inference endpoint, live S3 bucket, a second physical device or
Safari's installed extension. The Agent screen's browser tests exercise the
production-built static app, actual QuickJS worker, model/tool continuation,
scratch commits, S3 reload/restore, failed-script rollback, infinite-loop limits
and six presentation orientations. The remote bridge services are mocked.
Verified workspace-document tools, model-accessible general S3 resource tools,
incremental token streaming and GitHub mutations from issue #7 remain subsequent
slices. Session uploads are the only remote writes introduced here.

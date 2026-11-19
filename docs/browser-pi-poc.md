# Browser Pi agent proof of concept

The static hosted `pi.html` page runs **`@earendil-works/pi-agent-core` 1.5.2**.
The extension owns inference HTTP requests, optional secret headers, GitHub tokens
and S3 SigV4 signing. There is no agent backend. This is an initial runnable slice
of [issue #7](https://github.com/mickmister/github-ultimate/issues/7), not completion
of its broader workspace/document/streaming milestone.

## Try it

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

`hosted/pi-agent.ts` constructs the real Pi Agent with typed read-only tools:
`github_repositories` and `github_probe` (repository metadata and default-branch
commit identity). Tools bind the selected GitHub user and installation, which the
broker checks before use. The existing repository authorization is rechecked.

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
`<approved-prefix>/pi-sessions/<session-uuid>/<timestamp>-<checkpoint-uuid>.json`.
The actual prefix is concatenated with its existing trailing slash. Each object
contains the session/checkpoint/parent, creation time, versioned runtime identity,
portable binding and completed Pi user/assistant/tool transcript. Tools/system
instructions are rebuilt from this application, not executed from storage.
Each save uses the broker's create-only `If-None-Match: *` upload and verifies a
readback before claiming persistence. The session limit is 4 MiB (the general
broker transfer limit remains 8 MiB).

Portable bindings compare GitHub App/user/installation, inference model, S3
endpoint/bucket/prefix/region/addressing and the runtime/schema identity. The user
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
  It verifies private inference headers, GitHub auth, SigV4/create-only S3 requests,
  save/readback, reload/restore/continue and revoked inference access.
- `pnpm run check`, `pnpm run build:safari`, `pnpm run hosted:build` verify type and
  browser-target packaging. License notices are derived from bundled packages;
  Pi's npm distributions omit their license file, so the MIT text is retained from
  upstream `earendil-works/pi` tag `v1.5.2` in `licenses/pi-MIT.txt`.

These mocks prove the local architecture and serialization, not successful access
to a user's live inference endpoint, live S3 bucket, a second physical device or
Safari's installed extension. The normal TanStack workspace Agent panel, verified
document tools, model-accessible S3 resource tools, incremental token streaming,
edit proposals and GitHub mutations from issue #7 are subsequent slices. Session
uploads are the only automatic writes introduced by this POC.

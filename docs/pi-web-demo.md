# Alohak: durable browser conversations

The `/pi-web/` branch preview now runs a real text-only Pi 1.5.2 agent and stores
its conversations in the selected private S3 location. The old static demo and
tab-memory-only adapter have been superseded. The production source is
`pi-web/client/`; upstream provenance and license remain in `pi-web/UPSTREAM.md`.

## Browser setup

1. Install/reload the current browser extension. Configure a **Connect to ChatGPT**
   device-code connection or an existing OpenAI-compatible endpoint/header
   inference connection ([setup and limitations](connections.md#connect-to-chatgpt-browser-inference)),
   and S3 storage with reads/uploads enabled and overwrites
   disabled. Keep the same endpoint, bucket, prefix, region and addressing on each
   device; local connection UUIDs and credentials can differ.
2. Grant both connections the Pi Web origin and a directory containing `/pi-web/`.
   The preview's parent directory can cover both `app/` and `pi-web/`. A grant only
   for the sibling `app/` or old `pi/` entry does not cover `/pi-web/`.
3. Reload Pi Web. If exactly one connection of each kind is available, it is
   selected automatically. Otherwise open the gear **Settings → Connections** and choose explicitly.
4. Choose a nugs workspace, then select **New conversation** and compose a draft. No conversation, URL identity
   or S3 object is created until the first message is sent. That message is saved
   before inference; the settled reply is saved automatically. The URL then contains the exact conversation,
   checkpoint/version reference and a fingerprint of the storage location.
5. Reload or reopen the ordinary page URL to restore the conversation's latest
   saved continuation without resending. On another authorized device,
   use the same location and an inference connection with the saved model.
   **Conversations** shows one title/metadata row per canonical conversation UUID,
   opening its most recently saved continuation. **Refresh conversations** discovers
   other device saves and updates the open conversation when it is settled and
   saved, retaining an unsent composer draft. Search filters conversation titles. Listing resolves all S3
   pages before grouping, so a conversation never appears once per checkpoint.
   The footer shows the frontend build. Runtime scripts are requested with that
   build pin and must expose catalog protocol v2; incompatible cached scripts
   show a reload message instead of silently returning checkpoint-level entries.
   The view also deduplicates catalog entries by canonical session ID.
6. **Copy conversation link** creates an explicit historical link with
   `view=checkpoint`; that link stays pinned even across reloads. Selecting a
   conversation in the sidebar returns to its latest saved continuation. Older
   URLs without this explicit mode follow the latest conversation, using their
   checkpoint reference only as a fallback if no catalog entry exists.

## Workspace browsing and preview links

Open Pi Web's workspace chooser, or choose a nugs workspace in Documents and follow its **Pi Web** link. The GitHub
connection must also authorize the Pi Web directory. The sidebar displays the
selected workspace name; its switching icon opens the workspace chooser, which
selects the page scope by the storage repository and nugs workspace namespace.
The URL's `repository` and `workspace` parameters are authoritative for conversations
and previews. A bare URL shows the chooser rather than unscoped chat content.
**Unassigned migration inbox** contains older conversations without workspace
metadata; it permits reading/moving them, but no new conversations or inference.
**New conversation** inherits the selected workspace and still writes
nothing until the first send. Changing workspace preserves an unsent composer draft.
Under **Settings → Connections**, **Move conversation** assigns a saved conversation to an
existing authorized workspace or back to Unassigned.

**Change workspace** and the preview menu's **Choose workspace** open the in-page
chooser. Switching scopes adds a browser history entry; Back/Forward and reload
restore that scope. A conversation URL whose current association is elsewhere
shows an explicit destination instead of changing scope or rendering its transcript.
Catalog refresh detects moves made on another device and preserves an unsent draft.
Old unscoped conversation links are upgraded using their durable catalog identity.
Shared links omit device-local GitHub connection IDs; a receiving device resolves
a unique authorized connection for the explicit storage repository. Ambiguous or
missing authorization requires choosing the connection in Documents and never
changes the URL's workspace. Preview data from another scope stays hidden while
navigation/configuration loads; superseded preview requests cannot replace it.

The workspace navigation has a single **Chat** tab. The sidebar prioritizes the
conversation list and workspace name, with a subtle title-search field and icon
buttons for refresh and a new conversation (pencil/draft). Connection selections
and appearance live in the gear **Settings** modal; it remains open across device
layout changes without losing the draft. **Alohak** branding opens the exact route
in the native app from mobile browsers, using the existing navigation-only custom
scheme. On desktop or inside Alohak it opens the current deployment's `app/` home.

Association is a separate immutable, readback-verified `pi-web-catalog-1` record
under a deterministic metadata UUID in the same S3 checkpoint namespace. Moves do
not rewrite transcript checkpoints, invalidate pinned history or let an older
device's next reply undo a move. Reload and catalog refresh read the current
association. This picker browses existing nugs workspaces; provisioning a new
workspace from repositories remains pending, as do workspace file tools and
archive/delete actions.

The composer **Preview slots** menu reads `workspace-config.json` from the selected
nugs document snapshot. Each repository defines named services with either a
`github-pages` provider (`baseUrl`, relative `path`) or an explicit `url-template`
provider (`url`) for Cloudflare/custom hosts. Templates support `{workspace}`,
`{branch}`, `{owner}`, `{repository}` and `{previewDirectory}`. Branch context comes
from the matching manifest repository, and `previewDirectory` uses exactly the
publisher's sanitized branch prefix plus SHA-256 suffix, with cross-runtime parity
tests (the Pages publisher intentionally requires no npm installation). Example document:

```json
{"schema_version":1,"repositories":[{"repository":"owner/repo","previewSlots":[{"id":"storybook","title":"Storybook","service":"storybook","provider":{"kind":"github-pages","baseUrl":"https://owner.github.io/repo/","path":"previews/{previewDirectory}/storybook/"}}]}]}
```

Links open a new tab with no opener and preserve the draft. Refresh rereads the
configuration; this menu does not start services or deploy them. Missing config
shows an empty menu; malformed config or unavailable repository context shows an
explicit error. Git/nugs reads use the existing host GitHub bridge independently
of inference/S3 transport. Credentials stay with the host.

## Mobile setup

Alohak's native settings now include inference and S3 chat connections. Endpoints,
headers and signing credentials remain native; secrets use generation-bound secure
vault chunks and never AsyncStorage. Set the deployment to the `/pi-web/` URL and
grant both connections to it. This requires a mobile update containing the new Pi
bridge; a website refresh cannot update an older installed native JavaScript bundle.

The native path reuses the S3 and inference engines, a portable SigV4 signer and
the existing original-document authorization. Large requests and responses use
bounded ordered transfers, keeping every native ingress frame within 16 KiB.
Navigation/background invalidation clears transfer state and aborts native model
requests. This does not implement native-owned or lock-screen Pi execution.

## Durability and continuation

`hosted/pi-chat.ts` validates the `pi-web-chat-1` checkpoint profile. It uses the
existing `s3Checkpoint` broker operation under the approved
`pi-sessions/<session UUID>/` prefix, verifies payload SHA-256 and reads back the
exact stored object. B2 uses ordinary PUT and requires a returned version ID;
restore uses that exact version. Other endpoints retain create-only PUT behavior.

The user message is saved before inference starts. Completed, failed or aborted
replies are saved after settlement. A save failure keeps the in-memory state,
shows **Not saved** and blocks further sends until **Retry session save** succeeds.
An unsaved in-memory reply can still be lost if the page/process is killed.

A page reloaded from a pending checkpoint shows an interrupted turn. It never
automatically reissues the request; **Continue interrupted turn** is explicit.
Each restored device continuation gets a separate branch identity and records
its exact parent reference. There is no mutable latest pointer, cross-device lock,
last-write-wins overwrite or automatic branch merge. Explicit copied links pin checkpoints;
refresh and select the conversation to open its most recently saved continuation.
Selecting that continuation does not merge or delete other branches. Empty drafts
created by older builds and workspace-agent checkpoints are omitted from the chat
sidebar. Immutable checkpoint objects remain internal history.

### Provider transport

Updated extension/native hosts advertise `http-stream-v1`. Pi's OpenAI-compatible
provider adapter then owns request conversion, SSE decoding, thinking/text/tool
deltas and usage accounting through a custom `fetch` (`hosted/pi-fetch.ts`).
The synthetic page URL and API key are placeholders: the host fixes the actual
configured endpoint/model and applies its private custom headers. No arbitrary
page URL, credential headers or provider error bodies are forwarded.

`inferenceOpen` returns HTTP status and allowlisted response headers. Ordered,
pull-based `inferenceRead` requests return bounded text chunks; Stop, revocation,
document invalidation and a 90-second deadline cancel the host reader. Provider
responses remain limited to 2 MiB, requests to 1 MiB, and each chunk to 16,384
UTF-16 code units without splitting Unicode scalars. Native transfers retain the
existing frame bound and use a portable incremental UTF-8 decoder.

Install/reload an updated extension or receive the corresponding mobile update
to use this transport. Already-installed hosts without the advertised capability
continue using the bounded nonstreaming compatibility adapter. Website updates
alone cannot add a host operation. Streaming render snapshots are immutable so
the retained memoized upstream UI sees each delta; only settled replies are saved.
The historical `/pi/` POC is compiled with `PI_LEGACY_POC` and retains its original
nonstreaming transport and unchanged 768 KiB cap. The production Pi Web/workspace
app bundles include the SDK within their existing independent budgets.

The production entry does not patch global fetch/EventSource and ships no sample
repository, fake provider account or canned conversation. It retains upstream rich
message rendering. Tools, shell/filesystem, model switching
within a conversation, native background execution and old workspace-agent
checkpoint migration are outside this text-chat slice.

### Agent tool availability

The standalone `/pi-web/` chat currently configures `tools: []`. Its S3 saves are
application lifecycle operations, not model-invokable tools. Storybook tool cards
demonstrate retained rendering only.

The separate `/app/#/agent` workspace agent exposes `github_repositories`,
`github_probe`, `github_graphql` (read-only), `beads_query`, `codemode`, and
`git_commit` (scratch commits, not pushes). Codemode contains `list_files`,
`find_files`, `read_file`, `write_file`, `delete_file`, `apply_patch`, `search`,
`git_status`, `git_diff`, and `git_log`. These operate on the selected bounded
scratch workspace; there is no ambient shell or unrestricted network.

## Checks

### Render recovery and production debugging

The runtime's Pi SDK tool blocks use `id`, `name`, and `arguments`. A display-only
adapter maps them to the imported renderer's `toolCallId`, `toolName`, and `input`;
canonical S3 checkpoints retain the SDK format. Partial streamed calls are safe to
render before their name/arguments have arrived.

Each message has its own ErrorBoundary, including its SDK-to-display conversion,
so one failed message leaves neighboring messages visible. A transcript boundary
backs this up without unmounting the chat hook/composer. **Retry display** retries
rendering only, never inference/tools.
An outer application ErrorBoundary offers explicit reload/home navigation for
larger failures and shows the build/stack. Reload restores only saved state.

Production UI chunks and the extension runtime have linked source maps. Enable
JavaScript source maps in browser DevTools to inspect original first-party UI
source/lines. UI maps embed application source; dependency-only maps are compact
empty maps, and mixed maps omit dependency source text. Runtime maps retain source
paths/mappings without embedded source text. Maps count toward the unchanged
12 MiB Pi Web budget. No conversations or credentials are included in build maps.

`ChatSnapshot.messages` derives from the pinned published Pi SDK's `AgentMessage`
union. The display adapter uses the published content types and exhaustive
switches, rather than casts to the renderer's historical types. Chat Storybook
fixtures satisfy the same SDK contract. Client checks reject SDK types that become
`any`; parent checks reject direct SDK/renderer interchange. Demo-era ambient
stubs for `pi-agent-core` and `pi-ai` have been removed. The persistence schema
remains the runtime validator for supported saved messages and is compile-checked
as producing SDK-compatible messages. TypeScript alone cannot validate fetched JSON.

### Pi Web Storybook

Pi Web has its own React/Vite Storybook at `pi-web/client/.storybook/`, sharing
the production view components, upstream styles, Noto Sans Mono family and renderers.
The workspace app's Storybook stays independent. From the repository root:

```sh
pnpm run pi-web:storybook          # http://127.0.0.1:6012
pnpm run pi-web:storybook:build
pnpm run test:pi-web-storybook
```

Stories cover the conversation shell, draft, phone/tablet, interruption/save error,
Markdown/code, thinking/tool calls/results, streaming presentation, provider errors
and injected deferred-content loaders. Story fixtures never enter the production
entrypoint and do not enable live tool execution. `MessageView` no longer assumes
Node `/api/sessions` or `/api/agent` endpoints: optional display-only content loaders
come from the owning runtime through `MessageContentProvider`.

CI builds and browser-tests this Storybook separately and publishes one current
instance per branch at `/github-ultimate/pi-web-storybooks/<preview-directory>/`.
Its 14 MiB workbench budget is separate from the unchanged 36 MiB application
preview budget; both remain subject to the unchanged 50 MiB aggregate site cap.
Storybook metadata pins the source SHA, and branch cleanup prunes its workbench.

### Production checks

- Root, mobile and client typechecks; client lint and production static export.
- Chat tests: pre-inference durability, save failure/retry, portable connection IDs,
  restored history, divergent branches, model mismatch and tampered bytes.
- Native tests: secure-vault chunk restart, frame bounds, large responses, document
  invalidation and SigV4 conformance against the existing WebCrypto signer.
- Production Chromium/WebKit tests: six orientations, draft continuity, S3
  save/reload, independent-device restore/continue, branches, no global mock API
  traffic and no published demo manifest.
- Packaged Chromium extension: real brokers, private headers, signed B2 versioned
  checkpoints, reload/history continuation and save denial before inference.

Remote services are controlled fixtures in these tests. Native wire emulation and
an iOS bundle export are not installed-device acceptance. Actual user inference,
B2 credentials, physical cross-device behavior and release installation need
separate verification. The older `/app/#/agent` keeps its existing workspace/tools
and checkpoint contract.

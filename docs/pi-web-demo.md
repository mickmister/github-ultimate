# Pi Web: durable browser conversations

The `/pi-web/` branch preview now runs a real text-only Pi 1.5.2 agent and stores
its conversations in the selected private S3 location. The old static demo and
tab-memory-only adapter have been superseded. The production source is
`pi-web/client/`; upstream provenance and license remain in `pi-web/UPSTREAM.md`.

## Browser setup

1. Install/reload the current browser extension. Configure an OpenAI-compatible
   inference connection and S3 storage with reads/uploads enabled and overwrites
   disabled. Keep the same endpoint, bucket, prefix, region and addressing on each
   device; local connection UUIDs and credentials can differ.
2. Grant both connections the Pi Web origin and a directory containing `/pi-web/`.
   The preview's parent directory can cover both `app/` and `pi-web/`. A grant only
   for the sibling `app/` or old `pi/` entry does not cover `/pi-web/`.
3. Reload Pi Web. If exactly one connection of each kind is available, it is
   selected automatically. Otherwise use Connections and choose explicitly.
4. Select **New conversation** and compose a draft. No conversation, URL identity
   or S3 object is created until the first message is sent. That message is saved
   before inference; the settled reply is saved automatically. The URL then contains the exact conversation,
   checkpoint/version reference and a fingerprint of the storage location.
5. Reopen that URL to restore without resending. On another authorized device,
   use the same location and an inference connection with the saved model.
   **Conversations** shows one title/metadata row per canonical conversation UUID,
   opening its most recently saved continuation. **Refresh conversations** discovers
   other device saves; search filters conversation titles. Listing resolves all S3
   pages before grouping, so a conversation never appears once per checkpoint.
   The footer shows the frontend build. Runtime scripts are requested with that
   build pin and must expose catalog protocol v2; incompatible cached scripts
   show a reload message instead of silently returning checkpoint-level entries.
   The view also deduplicates catalog entries by canonical session ID.

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
last-write-wins overwrite or automatic branch merge. Links pin checkpoints;
refresh and select the conversation to open its most recently saved continuation.
Selecting that continuation does not merge or delete other branches. Empty drafts
created by older builds and workspace-agent checkpoints are omitted from the chat
sidebar. Immutable checkpoint objects remain internal history.

The production entry does not patch global fetch/EventSource and ships no sample
repository, fake provider account or canned conversation. It retains upstream rich
message rendering. Tools, shell/filesystem, streaming token deltas, model switching
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

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
2. Grant both connections the Pi Web origin and exact preview subpath. A grant for
   the sibling `app/` or old `pi/` entry does not cover `/pi-web/`.
3. Reload Pi Web. If exactly one connection of each kind is available, it is
   selected automatically. Otherwise use Connections and choose explicitly.
4. Create **New conversation**, wait for **Saved to S3**, and send text. A settled
   reply is saved automatically. The URL contains the exact conversation,
   checkpoint/version reference and a fingerprint of the storage location.
5. Reopen that URL to restore without resending. On another authorized device,
   use the same location and an inference connection with the saved model.
   **Conversations** loads paginated saved checkpoint references; select the
   continuation you want. **Refresh conversations** discovers other device saves.

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
refresh and choose a newer checkpoint to see another device's continuation.

The production entry does not patch global fetch/EventSource and ships no sample
repository, fake provider account or canned conversation. It retains upstream rich
message rendering. Tools, shell/filesystem, streaming token deltas, model switching
within a conversation, native background execution and old workspace-agent
checkpoint migration are outside this text-chat slice.

## Checks

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

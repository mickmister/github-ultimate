# Hosted native Beads read sample

Open `app/#/beads` in a published branch preview, or select **Beads read sample**
from Documents. The dashboard's workspace **Beads** tab carries its selected
connection, repository and workspace into this page. Query parameters may prefill
`connection`, `repository` and `workspace`; authority still comes from the host's
approved connection, installation and repository checks on every read.

Choose an approved connection and storage repository, discover a native workspace,
then select **Load snapshot and run reads**. The host validates the workspace's
Documents manifest and pins its `refs/dolt/<workspace>` commit/tree. Regular native
NBS/archive files and the native manifest are read through the privileged Git
broker. Every complete blob is size-checked and Git-hash verified. Large Dolt
files use the new `gitBlobPart` capability: 3 MiB replies, a 64 MiB native-file cap,
online authorization per part, and a bounded 96 MiB transient API cache. Ordinary
document reads remain capped at 16 MiB. Update the extension or Alohak if the
page reports that large native reads are unavailable.

The page loads one immutable release from `browser-tools.alohak.dev`, pinned in
`hosted/beads-sample.ts`. It checks the release manifest and client SHA-256 before
importing the SDK. The SDK verifies its Worker/runtime/WASM and every supplied
file. Private native files are passed using temporary local Blob URLs, never
uploaded to the CDN. The Worker decodes native chunks and resolves
`refs/heads/main` from the verified storage root.

The initial run executes upstream `list` (priority order, first 50 records),
`ready` (open, priority policy) and `blocked`. Each panel shows timing, result
count, issue summaries, the exact request and complete returned JSON. A successful
empty query is shown as zero results. Native Git snapshot, Dolt commit, storage
and issue roots and file/byte counts are displayed independently. Store write
and commit rejection are checked before the UI declares the sample successful.

**Run list/ready/blocked** reuses the same immutable snapshot. **Refresh snapshot
and run reads** resolves the current published workspace ref and creates a new
Worker. Cancelling, changing scope or leaving the page disposes the runtime and
revokes temporary file URLs. This page exposes reads only.

Verification: unit tests cover part bounds/reassembly/corruption, unchanged
document caps and per-call authorization. The browser test covers missing host
access. To explicitly test a private workspace with authorized Node-side `gh`
transport, run after `pnpm run hosted:build`:

```sh
BEADS_LIVE_WORKSPACE=your-workspace \
BEADS_LIVE_REPOSITORY=owner/storage \
pnpm exec playwright test tests/browser/beads-sample.spec.ts --grep 'executes list'
```

This opt-in test runs the production page and real published engine against
actual native Git blobs; it retains only compact identity/count evidence, with
network tracing disabled. It is not a claim of installed-extension login or
signed-device acceptance. Engine cross-browser tests use public synthetic native
fixtures; production private workspace bytes are not committed or uploaded as CI
artifacts.

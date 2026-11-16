# Workspace Beads Kanban

Open `app/#/beads` in a published branch preview, or select **Beads Kanban**
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

The initial run executes upstream `list` (priority order, no sample limit),
`ready` (open, priority policy) and `blocked`. The SVAR React Kanban board uses
the complete list and preserves exact issue IDs, including dotted child IDs.
Columns reflect stored status: Open, In progress, Blocked, Deferred and opt-in
Closed. Other statuses remain visible with their raw status in Other status.
Epics and children are individual cards; parents are not inferred from IDs.

Search by title/ID and filter by label, assignee, issue type and native readiness.
Ready and Dependency blocked badges/filters use the native query results, not
guesses based on stored status. An open issue can be dependency-blocked while
remaining in Open. Closed issues are hidden initially. Matching/total counts
include the complete loaded snapshot; ordering is priority P0–P4 then issue ID.
Unknown priorities are displayed honestly and sort last. Empty collections and
no matching results are separate states; ambiguous issue IDs fail explicitly.

Compact and Comfortable density use the same data/selection. Cards open a
read-only details pane with description, status, priority, labels, assignee,
available timestamps and full native JSON. Enter activates a focused card;
Escape dismisses details and restores card focus. The board follows the system
light/dark theme and has horizontally scrollable columns on narrow screens.
Drag/drop, editing and persisted card reordering are disabled.

Expand **Native query diagnostics** for timing, counts, issue summaries, the exact
request and complete returned JSON. A successful empty query is shown as zero
results. Native Git snapshot, Dolt commit, storage
and issue roots and file/byte counts are displayed independently. Store write
and commit rejection are checked before the UI declares the sample successful.

**Run list/ready/blocked** reuses the same immutable snapshot. **Refresh snapshot
and run reads** resolves the current published workspace ref and creates a new
Worker. Cancelling, changing scope or leaving the page disposes the runtime and
revokes temporary file URLs. Scope/snapshot changes also reset board filters and
selection so another workspace's tasks cannot remain visible. This page exposes
reads only. The engine stays on the existing integrity-pinned CDN; this feature
does not add WASM or private data to GitHub Pages assets.

## Storybook

**Web app / Beads Kanban** contains Compact, Comfortable, Empty, Choose workspace,
Readiness unavailable, Long titles, Large workspace (1,000 synthetic tasks),
Invalid snapshot and Workspace switch stories. Fixtures are invented and do not
load the CDN, extension or private workspace data. Run `pnpm run webapp:storybook`
or browse the branch preview's published `/storybook/`.

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

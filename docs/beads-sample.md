# Workspace Beads Kanban

Open `app/#/beads` in a published branch preview, or select **Beads Kanban**
from Documents. The dashboard's workspace **Beads** tab carries its selected
connection, repository and workspace into this page. Query parameters may prefill
`connection`, `repository` and `workspace`; authority still comes from the host's
approved connection, installation and repository checks on every read.

On the first visit, choose an approved connection and storage repository, find a
workspace, then select **Open workspace**. The page remembers that choice through
the shared application storage API (browser, extension, or Alohak persistence).
Returning to `app/#/beads` restores it and automatically downloads its tasks.
Complete workspace links also load automatically and override the saved choice;
partial links never borrow fields from another remembered workspace. A remembered
connection must still exist in the host's current approved connections. Use the
workspace button in the compact header to switch; the picker otherwise stays
hidden. Changing the selection also updates the workspace link for reloads.

The host validates the workspace's
Documents manifest and pins its `refs/dolt/<workspace>` commit/tree. Regular native
NBS/archive files and the native manifest are read through the privileged Git
broker. Every complete blob is size-checked and Git-hash verified. Large Dolt
files use the new `gitBlobPart` capability: 3 MiB replies, a 64 MiB native-file cap,
online authorization per part, and a bounded 96 MiB transient API cache. Ordinary
document reads remain capped at 16 MiB. Update the extension or Alohak if the
page reports that large native reads are unavailable.

Native files download with up to six concurrent file reads. The updated host
also permits six native blob reads, reserving at most 144 MiB of aggregate
upstream response limits (24 MiB per ordinary blob, 96 MiB per large-blob part),
with at most 64 waiting calls. This is a response-admission budget, not a total
browser-memory limit. Authorization and token rotation remain serialized; native
blob HTTP/body reads overlap outside that lane. Each completed response rechecks
the current document, grant, connection, account, installation and cache generation
before disclosure. Large-file parts stay sequential within each file and reuse
the bounded transient whole-object cache. Older hosts still serialize downloads.

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

Search by title/ID; **Filters** opens label, assignee, issue-type and readiness
controls. Active filters and card density are automatically persisted separately
for each connection/repository/workspace. **Save filters** records a named filter
set, which can be reapplied using the **Saved filters** dropdown. Saving with an
existing name updates it; **Delete saved filter** removes it. Deletion keeps the
current active filters. **Clear filters** restores the default active-work view.
Named sets are immutable snapshots of filters until explicitly saved again;
editing the current search does not rewrite a saved set. Settings store only
preferences, never issue bodies or engine state. Storage failures are shown as
actionable errors and do not prevent task browsing. Saved sets share the existing
page-storage quota; deleting a set frees space.

Ready and Dependency blocked badges/filters use the native query results, not
guesses based on stored status. An open issue can be dependency-blocked while
remaining in Open. Closed issues are hidden initially. Matching/total counts
include the complete loaded snapshot; ordering is priority P0–P4 then issue ID.
Unknown priorities are displayed honestly and sort last. Empty collections and
no matching results are separate states; ambiguous issue IDs fail explicitly.

Compact and Comfortable density use the same data/selection. Cards open a
read-only details pane with description, status, priority, labels, assignee,
and available timestamps. Enter activates a focused card;
Escape dismisses details and restores card focus. The board follows the system
light/dark theme and has horizontally scrollable columns on narrow screens.
Drag/drop, editing and persisted card reordering are disabled.

The page is board-first: search, saved filters, a compact count and the task board.
Debug panels, raw JSON, engine hashes, query logs and redundant explanatory copy
are not displayed. Loading uses one concise status; errors remain visible. The
reader still verifies immutable snapshot identity and store write/commit rejection
before exposing tasks; removing diagnostic UI does not remove those checks.

**Refresh** resolves the current published workspace ref and creates a new
Worker. Cancelling, changing scope or leaving the page disposes the runtime and
revokes temporary file URLs. Refresh clears issue selection but preserves filters.
Changing workspaces loads that workspace's own saved filter preferences so another
workspace's tasks or active filters cannot remain visible. This page exposes
reads only. The engine stays on the existing integrity-pinned CDN; this feature
does not add WASM or private data to GitHub Pages assets.
Cancellation or a failed download stops scheduling more files and drains active
reads before final cleanup. Already-started host HTTP reads may finish; cancelled
results are discarded and cannot create new file URLs after cancellation.

## Storybook

**Web app / Beads Kanban** contains Compact, Comfortable, Empty, Choose workspace,
Readiness unavailable, Long titles, Large workspace (1,000 synthetic tasks),
Invalid snapshot, Workspace switch, Remembered workspace and Removed connection
stories. The remembered-workspace story exercises real application preference
storage with an invented task-reader host. Fixtures are invented and do not
load the CDN, extension or private workspace data. Run `pnpm run webapp:storybook`
or browse the branch preview's published `/storybook/`.

Verification: unit tests cover part bounds/reassembly/corruption, unchanged
document caps, actual broker HTTP overlap/count and response-byte caps, serialized
refresh, and revocation/navigation during active and queued reads. The browser test covers missing host
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

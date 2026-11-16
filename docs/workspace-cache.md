# Workspace read cache

The extension and Alohak mobile host persist successful workspace reads. The
shared settings contract is `src/cache-settings.ts`; the policy and eviction
engine is `src/workspace-cache.ts`. These are device-local settings, not synced
preferences or workspace-owned data.

## Settings

Open the extension's **Connections → Workspace cache**, or Alohak's **Native
settings → Workspace cache**. Both surfaces expose the same validated fields:

| Setting | Default |
| --- | --- |
| Persist Dolt reads | On |
| Cached Documents workspaces | 10 |
| Cached Dolt workspaces | 10 |
| Total cache capacity | 100 MiB |

Documents and Dolt have separate workspace-count limits and share the byte budget
with cached GitHub metadata and supported S3 reads. Least-recently-used workspace
groups are evicted coherently when either limit requires it. Revalidation does
not advance a group's visit time; restoring its persisted reads does. Disabling
Dolt persistence removes its disposable cache and leaves live reads available.
Remote Documents, native authoritative Beads data, credentials and authored drafts
are not cache-eviction targets.

The displayed usage counts serialized cache records, keys and the metadata index.
It is not a promise about the database's allocated file size or OS/browser quota.
Storage failures are visible in settings; an oversized read can succeed without
being persisted. The current write's workspace is protected while deciding which
other groups to evict. If that workspace alone cannot fit, its last good records
are retained and the new record is not admitted.

## Storage and read behavior

- Desktop bulk records use a separate extension-origin IndexedDB database;
  small settings use `storage.local`. Hosted navigation uses page localStorage.
- Mobile bulk records use `expo-sqlite` in the native host, outside the WebView.
  Small settings use native AsyncStorage; credentials remain in SecureStore.
  Installing this change requires a rebuilt native binary with SQLite linked.
- Object keys include account, connection, installation, access generation,
  repository, workspace, namespace and semantic resource identity. A local
  revoke/disconnect/installation change retires the old generation, even if
  physical deletion fails.
- `GitRead.cacheOnly` performs a local, scoped persisted read without HTTP. It is
  still subject to local grant/identity and native-document checks. Normal reads
  revalidate repository membership, conditionally check mutable data and reuse
  verified immutable Git objects. Blob bytes are hashed before persistence and
  checked again on restoration.
- TanStack Query deduplicates live hosted requests. Durable object storage is
  independent of its in-memory query garbage collection. Documents restore a
  cached preview before revalidating, retaining it on transient errors and
  clearing it on explicit access denial. Focus/reconnect and visible-page polling
  check latest browsing; review pins retain their original revisions.
- Supported extension S3 list/read results are persisted under the connection's
  configuration revision and pagination identity. GETs use ETag revalidation
  where available. Uploads remain network-only and invalidate cached results.
  OAuth/token responses and mutation responses are never cache-replayed.

## Complete Documents snapshots

Opening a workspace in the Documents app starts background filling after the
foreground open completes. The open document has first priority, followed by
review request/form files and then the remaining Documents objects. Browsing is
not held busy by prefetch. The page displays progress, completion or a paused
reason separately from foreground loading/errors.

The host's `documentSnapshots` capability exposes bounded `documentCache` fill and
restore calls. A fill downloads at most one missing document blob (plus manifest
and inventory metadata when first preparing a snapshot). Objects are deduplicated
by OID within the workspace. Persisted, checksummed objects form the resume journal;
closing the page/browser or replacing the mobile WebView pauses filling without
discarding its completed downloads. Reopen online, focus/reconnect or visible-page
polling retries a paused fill. An old preview never replaces a newer pending fill.

The host validates the workspace manifest and complete Git tree, then verifies
every required blob's Git hash and size before promotion. The completed-snapshot
index replacement and old-object collection share one IndexedDB/SQLite adapter
transaction. The last complete snapshot remains available during interrupted or
over-capacity refreshes. Completed and pending snapshots share the configured byte
budget; if both cannot fit, caching pauses rather than destroying the last good
snapshot. The new snapshot is usable online while its fill is incomplete.

Restore prefers the last complete snapshot, independently of cached mutable refs.
After restoration, live browsing checks the latest published revision. Once a
snapshot is complete, even documents never individually opened can be read from
that host's cache. Corruption or missing objects invalidate completeness and are
repaired on a subsequent online fill. Unsupported files, missing sizes, truncated
trees, manifests over 256 KiB and document blobs over 16 MiB pause completion with
an explicit reason; partial inventories are never promoted.

Review reads on capable hosts conservatively retain their pinned commit/tree/blob
resources across latest-snapshot collection. These pins persist across page and
host restarts and are released with whole-workspace eviction or access cleanup.
At the bounded pin-index limit, individual collection is disabled for that
workspace rather than deleting a potentially active revision. Count/byte eviction
still applies to the workspace as a whole; this is disposable cache, not durable
storage for authored review data.

## Remaining boundaries

Completion is **per Documents snapshot**, shown in the Documents app. The legacy
aggregate settings field `completeSnapshots: false` remains a statement that the
cache does not guarantee completeness for every workspace/namespace. Eviction,
quota failure, an incomplete fill or unsupported objects can prevent offline reads.
The remotely loaded app shell and its assets are not installed offline by this
feature. Current mobile capabilities do not include S3 or review submission merely
because a cache adapter exists. Installed-device lifecycle acceptance remains
separate from adapter tests and native compilation.

The Beads sample reads native Dolt blobs up to 64 MiB using bounded
3 MiB bridge replies, with full Git hash verification after reassembly. These
large-object parts use the connection-scoped transient API cache and are not
persisted for offline replay. Ordinary document blobs retain their 16 MiB limit.

Tests cover resumable Documents fill across real SQLite file reopen and IndexedDB
replacement, prioritized downloads, atomic promotion failure, last-complete
retention, review pins, unsupported inventories, count/byte eviction, corruption
repair, ETag reuse and access retirement. The packaged-extension browser test
interrupts a background fill, replaces the browser, resumes it and then replaces
the browser again with GitHub HTTP unavailable to read a never-opened document.
Metro exports
and native build CI cover both platforms; installed-device lifecycle acceptance
must be recorded separately from compilation and Node SQLite adapter tests.

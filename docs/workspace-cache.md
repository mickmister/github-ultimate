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

## Foundation boundary

This is **read-through persistence**, not whole-workspace prefetch. Settings/status
report `completeSnapshots: false`; an unopened document, evicted record or object
over the current transport limit may be unavailable offline. The mobile app shell
is still loaded remotely. Current mobile capabilities do not include S3 or review
submission merely because a cache adapter exists.

The next slice owns complete Documents inventories, resumable prioritized fills,
old-snapshot garbage collection, active review retention and large-object/tree
transport. Large Dolt objects still respect the existing 16 MiB Git read limit.

Tests cover real SQLite file reopen, IndexedDB adapter replacement, count/byte
eviction, corruption recovery, ETag reuse, access retirement, optimistic document
rendering and packaged-extension browser restart with failed HTTP. Metro exports
and native build CI cover both platforms; installed-device lifecycle acceptance
must be recorded separately from compilation and Node SQLite adapter tests.

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

## Fetch-driven Documents caching and review prefetch

Opening Documents fetches the verified workspace metadata and manifest needed to
browse the tree. A document's body is fetched when it is opened. Successful reads
use the host's existing read-through cache; listing, searching, refreshing or
reopening a workspace does not start a background download of every document or
form. Refresh may revalidate the selected document, but does not warm unopened
resources.

Offline preview restores cached refs, commit/tree metadata, manifest and any
previously fetched document bytes. A tree entry alone does not mean its body is
available offline. An unopened/evicted document is a cache miss; the UI does not
claim a complete offline workspace. Existing cached objects remain reusable within
the normal capacity, eviction, integrity and access rules.

Entering a **review-request detail screen** starts bounded prefetch of all that
request's document targets, form DSLs and pinned document baselines. Inbox listing
does not prefetch those contents. Exact resource/version/snapshot identities are
deduplicated, including in-flight reads; switching between downloaded members
does not fetch their bodies again. A failed member can be retried independently
without blocking the others. Successful prefetch reads use the same host cache
as foreground reads, not a second workspace-wide download mechanism.

Review reads on capable hosts retain their exact pinned commit/tree/blob resources
against legacy per-object snapshot collection. Whole-workspace eviction and access
cleanup still apply; this is disposable cache, not durable authored review data.
The broker's older `documentSnapshots`/`documentCache` inventory protocol remains
compatible with older deployed clients, but the current Documents app no longer
invokes fill/restore inventory operations or advertises full-snapshot completion.

## Remaining boundaries

The aggregate settings field `completeSnapshots: false` states that the cache does
not guarantee completeness for every workspace/namespace. Eviction, quota failure,
an unfetched document or unsupported objects can prevent offline reads.
The remotely loaded app shell and its assets are not installed offline by this
feature. Current mobile capabilities do not include S3 or review submission merely
because a cache adapter exists. Installed-device lifecycle acceptance remains
separate from adapter tests and native compilation.

The Beads sample reads native Dolt blobs up to 64 MiB using bounded
3 MiB bridge replies, with full Git hash verification after reassembly. These
large-object parts use the connection-scoped transient API cache and are not
persisted for offline replay. Ordinary document blobs retain their 16 MiB limit.

Tests cover fetched-document reuse, no background warming on browse/refresh,
review-detail-only prefetch of all pinned members/baselines, read deduplication,
count/byte eviction, corruption, ETag reuse and access retirement. The packaged
extension test replaces the browser and restores a fetched document offline while
confirming that an unopened document was never downloaded and is not available
offline. Legacy inventory tests still cover explicit older-client fill/restore
operations across SQLite reopen and IndexedDB replacement.
Metro exports
and native build CI cover both platforms; installed-device lifecycle acceptance
must be recorded separately from compilation and Node SQLite adapter tests.

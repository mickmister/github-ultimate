# Origin-scoped page storage

`hosted/page-storage.ts` exposes the same hydrated, string-valued storage API
for plain browsers, the extension, and the installed iOS/Android Alohak app.
The proof UI is `mobile-proof.html` in each hosted build.

## Scope and approval

- The namespace is the **exact origin**: scheme, host and port. Subdomains and
  non-default ports have independent data. Approved paths on the same origin
  share data, including different branch previews on the same Pages origin.
- An origin/directory-subpath grant controls which documents may access that
  namespace; it does not create a separate namespace for each path.
- Extension settings have a separate **Page data storage** section. Grant the
  origin and directory, then reload the hosted page to inject the current relay.
  The extension also requires the browser's host permission.
- In native settings, configure the deployment and enable **Approve page
  storage**. The fixture switch is independent. Deployment/grants remain
  in-memory and require approval after a cold launch; page values persist.
- The privileged broker uses the original document URL captured by the
  extension relay at `document_start`, or supplied by the native adapter with
  main-frame identity and document generation. Request parameters cannot select
  an origin. History API rewrites cannot promote an initially denied document.
- Revocation denies subsequent operations, including from already-open pages.
  It retains persisted values. Use `clear()` while approved to delete them.
  Already-disclosed or optimistic in-memory values cannot be recalled.

Page storage approval grants no GitHub App connection or S3 access. Connection
grants grant no page storage access. Page storage is for app preferences and
other page data; anything stored here is readable by approved page scripts.

## Startup and synchronous methods

Choose the backend explicitly and **await hydration before importing or
starting the application**. For a bundled frontend in this repository:

```ts
import { openPageStorage } from './page-storage'; // adjust source import path

const session = await openPageStorage('extension', true);
// true opts into replacing window.localStorage after successful hydration.
// Choose 'browser' or 'mobile' explicitly for those deployments.
await import('./your-app');

session.storage.setItem('editor.theme', 'dark');
await session.storage.flush(); // resolves only when queued writes succeed
```

Without the second argument, use `session.storage` directly and leave
`window.localStorage` alone. Both forms support `getItem`, `setItem`,
`removeItem`, `clear`, `key` and `length`. Empty-string values and dotted or
`__proto__` keys are preserved. Property access such as `localStorage.theme`,
enumerating object properties, and browser `storage` events are not supported.
No existing browser-local data is automatically imported.

Reads are synchronous from an optimistic mirror. Writes update that mirror
synchronously and persist asynchronously, in order. Quota/input violations
throw before changing it. A persistence failure emits `page-storage-error`
on `window`, causes `flush()` to reject, and stops subsequent queued writes.
After an ambiguous failure, explicitly close/reopen and rehydrate; writes are
never silently retried against a different backend. The mirror may still hold
uncommitted values, so a successful `getItem` is not durability confirmation.

Use `await session.storage.refresh()` to fetch other clients' committed changes.
Refresh first flushes this client's writes and temporarily rejects new writes.
Transactions preserve independent keys across clients, but other clients'
changes are not pushed into an existing mirror; same-key writes are last-writer
wins. `clear()` clears the entire origin namespace. Before deliberate teardown,
await `flush()` and then call `session.close()`; closing stops queued work and
restores the original localStorage descriptor when overridden. Pagehide and
visibility flushes are best effort, not an OS-termination durability guarantee.

## Persistence and limits

| Backend | Persistence | Authority |
| --- | --- | --- |
| Browser | Page-origin IndexedDB, `github-ultimate-page-kv` | Browser same-origin policy |
| Extension | Extension-owned IndexedDB, same dedicated database name | Independent grants + browser host permission + original top-document URL |
| Mobile | Native AsyncStorage, dedicated origin-encoded key prefix | Independent native storage grant + current native main-document identity |

These are separate device/profile/backend stores, not a cloud synchronization
service. Browser storage clearing, extension uninstall, or app uninstall can
remove the corresponding data. IndexedDB read/modify/write is atomic; the
mobile app's single broker serializes AsyncStorage read/modify/write operations.

Each origin allows 128 entries, keys up to 256 JavaScript string code units,
values up to 4096 code units, and 64 KiB measured conservatively as twice the
JSON-serialized entry-array length. An encoded request also has a 12 KiB UTF-8
limit, including JSON escaping, leaving room inside the native 16 KiB request
envelope. Responses contain a bounded full snapshot and revision.

The design follows Songdrive/Springboard's RPC-backed localStorage mirror, but
awaits initialization, handles empty strings and all method-based mutations,
isolates origins, and exposes persistence failures and explicit flushing.

## Verification

`tests/page-storage.test.ts` exercises origin/port isolation, persistence,
quotas, queued authorization/generation checks, independent native grants, and
hydrated-mirror failure behavior. `tests/browser/page-storage.spec.ts` exercises
the packaged extension, window.localStorage replacement in Chromium, persistence
across a browser restart, spoofed initial paths, revocation and a plain browser.

Physical iOS/Android persistence and frame/lifecycle isolation still require
the device probes in [mobile-alohak.md](mobile-alohak.md), including cold
launch/reapproval, in-flight revocation/navigation, and background/process loss.

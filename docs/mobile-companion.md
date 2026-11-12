# Mobile companion: fixture shell and page storage

The mobile companion is an Expo/React Native app for **iOS and Android**. Its
WebView loads an explicitly configured remote HTTPS deployment. The installed
app exposes JSON-RPC through a native, document-bound transport. The desktop
extension retains its existing protocol and behavior.

The shell implements `companion.discover`, `fixture.echo` and independently
approved `kv.snapshot/set/remove/clear` page-data operations. No
GitHub/S3 credentials, OAuth, private reads or remote write methods are present. Device
flow, GitHub reads, then S3 are the selected subsequent direction; an optional
managed backend is not required by this shell. Eventual store distribution is
intended, with a personal device pilot first.

## Run on devices

Use Node 22 and the repository's pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir mobile run check
pnpm --dir mobile run ios -- --device
# On a host with Java 17 and Android SDK/device tooling:
pnpm --dir mobile run android -- --device
```

`expo run:*` generates native projects and builds the local module. Expo Go
cannot run this custom native view. iOS needs a Mac/Xcode and an appropriate
signing team for a physical device. Android requires a current System WebView
supporting `WEB_MESSAGE_LISTENER`; unsupported versions fail closed.

Pilot IDs are `dev.githubultimate.companion` (both platforms), and the scheme is
`githubultimate`. Choose final identifiers before distribution. No cloud build
account, OAuth backend, signing identity or store project is embedded.

Build/publish the normal branch Pages preview, which now includes
`mobile-proof.html` beside the dashboard. Alternatively serve the same build on
a controlled HTTPS host. On the device:

1. Enter the complete HTTPS `mobile-proof.html` URL in **Native settings** and
   tap **Set deployment**. An optional `EXPO_PUBLIC_COMPANION_URL` build variable
   prefills this field; it does not approve it.
2. Inspect the displayed origin/directory and enable **Approve fixture bridge**.
3. On the remote page, tap **Discover and echo**. Expect protocol 1, `fixtureOnly:
   true`, the two allowed methods, and echoed text.
4. Revoke the grant in native settings and repeat; expect denial. Re-enable
   explicitly. Grants and the selected deployment are intentionally in-memory
   for M1 and require setup after a cold launch. There is no credential import.

To test page data, enable **Approve page storage** independently, choose
**Mobile companion** in the proof page's storage backend selector, and tap
**Open page storage**. Save an empty/dotted-key value, refresh, reload the
WebView, and cold-launch/reconfigure/reapprove to verify persistence. Revoke
storage while the page stays open and refresh again; expect denial while the
fixture proof still works. See [page-storage.md](page-storage.md) for the shared
API, startup hydration, origin scope, asynchronous durability and quotas.

The granted directory is the entry URL's containing directory, including its
descendants, not all paths on the Pages origin. Configure a dedicated proof
directory if approving the entire branch preview is too broad. Only trust
scripts within the approved deployment. Same-origin path separation does not
isolate hostile scripts/service workers from one another.

## Songdrive reference and differences

Reviewed `~/repos/songdrive/apps/mobile/{App.tsx,app/main_webview.tsx,app.config.ts}`.
Reused the ideas of an Expo app, registered scheme, initial/warm link handling
and JSON-serialized native-to-page messages. This implementation uses remote
HTTPS rather than local HTML assets, and no Springboard engine. It does not
carry over wildcard origins, file access, shared third-party cookies or
debugging permissions. The native adapter is local Expo module source under
`mobile/modules/companion-webview/`, not a fork of Songdrive.

## Native trust boundary

The generic React Native `onMessage` payload URL alone cannot establish frame
identity. This view uses native checks:

- **iOS:** `WKScriptMessage.frameInfo.isMainFrame`/security origin and the main
  response URL captured before document execution. Navigation generations bind
  the response to its committed document; History API calls cannot acquire a
  different load-time grant.
- **Android:** AndroidX WebKit `addWebMessageListener` with an exact HTTPS
  origin, `sourceOrigin` and `isMainFrame`. Never falls back to
  `addJavascriptInterface`. Document identity is captured from native page
  navigation, not a page-provided pathname. Android lifecycle ordering, early
  History API changes and redirects require device verification.
- Both deny external/subframe navigations and popups in the bridged view,
  reject non-HTTPS entries, and invalidate generations on load/failure/process
  loss. Android disables file/content access and mixed content; certificate
  errors are never bypassed. Blocked external URLs are not auto-opened; a
  separate explicit system-browser action belongs with future login support.
- Replies/bootstrap props include the native document ID. Native checks it
  **before** evaluating the app-bundled script; the injected receiver checks
  it again. Serialized response bytes cannot become executable source.
- The bundled TypeScript broker rechecks the native context and current grant
  for every call, including discovery. Fixture methods are synchronous. Page
  storage is asynchronous, serialized, and rechecks the storage grant and
  document generation before and after persistence. An in-flight write may
  already commit when revocation occurs; its result is suppressed and the
  client must explicitly reopen rather than replay it. Requests
  must be JSON-RPC 2.0 with a bounded string ID/named params, <=16 KiB UTF-8;
  echo is <=1024 characters. Batches, notifications, unknown methods/fields and
  incompatible protocol versions are rejected. The page adapter bounds pending
  calls at eight, times them out and discards stale generations.
- Native settings cannot be opened/approved through page RPC. Backgrounding
  invalidates the broker; foregrounding recreates the WebView. Reload is the
  recovery path for process failure. Native settings remain available if the
  remote page fails. Native back navigation, download/file-picker integration
  and full offline persistence are not claimed by M1.

The UA marker only suppresses handoff UI before bridge initialization; it is
not an authorization signal. Neither an injected nonce nor page-side checks
replace the native trust boundary. Approved-page scripts can see everything
their methods return. Do not enable real credentials until device acceptance.

## Custom-scheme pilot

The proof page offers **Open in app**, **Stay on web**, and an opt-in preference
for a single automatic attempt on a future mobile visit. There is no repeated
retry or installed-app detection; a tap may still be necessary. The automatic
preference stores only a boolean. It is suppressed inside the companion even
before the bridge becomes ready. This pilot is on the proof page; integration
of the handoff UI into the production webapp is a later milestone.

Links look like:

```text
githubultimate://open?route=%2Fproject%2Fpreview%2Fapp%2F%3Fworkspace%3Da%23%2Fdocuments
```

Only `route` is accepted. The installed deployment supplies the origin and
allowed directory; links cannot set a connection, grant, endpoint, arbitrary
URL or RPC operation. Query and fragment navigation survive validation. Links
cannot contain secrets/body text; route metadata still appears in browser
history. Custom schemes can be claimed by other apps, so this is not verified
HTTPS linking. Without a configured deployment, a cold link waits for native
setup. Warm duplicates are suppressed until the next foreground cycle.

For testing after installation/configuration, opening such a link from a web
page should reach the same route in the app. Simulator/development commands:

```sh
xcrun simctl openurl booted 'githubultimate://open?route=%2Fproject%2Fpreview%2Fmobile-proof.html'
adb shell am start -a android.intent.action.VIEW -d 'githubultimate://open?route=%2Fproject%2Fpreview%2Fmobile-proof.html' dev.githubultimate.companion
```

Use your configured directory in place of `/project/preview/`. A future
Universal/App Link implementation needs controlled root association-file
hosting; no domains/association files are provisioned here.

## Checks and remaining acceptance

Manual cloud builds and installed-shell OTA updates are available through the
[EAS dispatch workflows](mobile-eas.md). Updates require an EAS-enabled native
build and a matching native fingerprint. Builds without a configured Expo
project keep EAS Updates disabled and continue to work as the local M1 shell.

```sh
pnpm run check
pnpm --dir mobile run check
pnpm exec vitest run tests/mobile-companion.test.ts tests/page-storage.test.ts
pnpm --dir mobile exec expo install --check
pnpm --dir mobile exec expo-modules-autolinking resolve --platform apple
pnpm --dir mobile exec expo-modules-autolinking resolve --platform android
pnpm --dir mobile exec expo prebuild --no-install --platform all
pnpm --dir mobile run export
pnpm run hosted:build
```

The tests exercise policy denial, stale native context, malformed/bounded RPC,
navigation-only links, actual bootstrap/reply execution with hostile strings,
and the actual page client's structured round trip. They **do not** establish
WKWebView/Android WebView isolation. Expo export builds both Hermes bundles;
prebuild/autolinking confirm project generation, not Swift/Kotlin compilation.
`mobile-companion.yml` compiles the Android debug app and iOS simulator app in
CI, with no release-signing secrets. Native compilation is not device evidence.

Physical-device acceptance remains `task-3vt.39.6.3`. Record source SHA, native
build, OS/System WebView versions, URLs, expected/actual results for:

| Probe | Required result |
| --- | --- |
| Approved top document / denied grant | Fixture discovery+echo / no result disclosure |
| Sibling directory; encoded separators; earliest inline History spoof | No promotion into an approved document |
| Cross/same-origin iframe, srcdoc, nested frames, popup | No accepted frame-originated broker calls |
| Redirect to denied URL, back/forward restore, reload during request | Old generation invalidated; no stale reply injected |
| Grant revocation, background/foreground, process kill | Denial/reconnect without implicit fallback |
| Storage-only approval and fixture-only approval | Each permits only its own methods |
| Storage reload/cold launch/reapproval; revoke during pending writes | Origin values persist; no stale result or implicit replay |
| Cold/warm/duplicate links and malicious route parameters | Only the configured deployment opens; no authority granted |
| Offline/TLS/load failure | Native settings/retry available; no certificate bypass |
| Page/app protocol mismatch | Explicit incompatibility error |

M1 stays unaccepted until the signed/device round trip passes. Next is native
secure storage and real device-flow/private-read proof, then S3; no actual
GitHub auth, S3 access, mobile Dolt WASM viability or App Store acceptance can
be inferred from this fixture shell.

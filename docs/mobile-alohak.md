# Alohak: native GitHub connections and page storage

Alohak is an Expo/React Native app for **iOS and Android**. Its
WebView loads an explicitly configured remote HTTPS deployment. The installed
app exposes JSON-RPC through a native, document-bound transport. The desktop
extension retains its existing protocol and behavior.

The shell implements `alohak.discover`, `fixture.echo` and independently
approved `kv.snapshot/set/remove/clear` page-data operations. Optional native
GitHub App device flow, private reads and explicit review draft/submission operations
reuse the extension's connection engine. GitHub App connections are always
available; each connection still requires explicit sign-in and deployment grants.
No managed auth backend is required. Eventual store
distribution is intended, with a personal device pilot first.

## Run on devices

Use Node 22 and the repository's pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir mobile run check
pnpm --dir mobile run ios -- --device
# On a host with Java 17 and Android SDK/device tooling:
pnpm --dir mobile run android -- --device
```

`expo run:*` generates native projects and builds patched react-native-webview.
Expo Go cannot run this patched native contract. iOS needs a Mac/Xcode and an appropriate
signing team for a physical device. Android requires a current System WebView
supporting `WEB_MESSAGE_LISTENER`; unsupported versions fail closed.

App IDs are `dev.alohak.mobile` (both platforms), and the scheme is
`alohak`. The default Expo project is
`c198f19d-590b-4362-85f8-9e48c34db45a`; `EXPO_PROJECT_ID` can override it.
No OAuth backend, signing identity or GitHub App credentials are embedded.

Build/publish the normal branch Pages preview, which now includes
`mobile-proof.html` beside the dashboard. Alternatively serve the same build on
a controlled HTTPS host. On the device:

1. Enter the complete HTTPS `mobile-proof.html` URL in **Native settings** and
   tap **Set deployment**. An optional `EXPO_PUBLIC_ALOHAK_URL` build variable
   prefills this field; it does not approve it.
2. Inspect the displayed origin/directory and enable **Approve fixture bridge**.
3. On the remote page, tap **Discover and echo**. Expect protocol 1, `fixtureOnly:
   true`, the two allowed methods, and echoed text.
4. Revoke the grant in native settings and repeat; expect denial. Re-enable
   explicitly. **Set deployment** now saves the confirmed URL on the device and
   automatically restores/loads it on cold launch, including after phone restart.
   The separately chosen fixture/page-storage permissions persist too. Changing
   the deployment resets those permissions; reapplying the identical URL retains
   them. Failed writes report an error rather than claiming the new setting is
   saved. GitHub connections have their own persistent grants, described below.

To test page data, enable **Approve page storage** independently, leave
**Automatic** in the proof page's storage backend selector, and tap
**Open page storage**. Save an empty/dotted-key value, refresh, reload the
WebView, and cold-launch to verify restored settings and values. Revoke
storage while the page stays open and refresh again; expect denial while the
fixture proof still works. See [page-storage.md](page-storage.md) for the shared
API, startup hydration, origin scope, asynchronous durability and quotas.

The granted directory is the entry URL's containing directory, including its
descendants, not all paths on the Pages origin. Configure a dedicated proof
directory if approving the entire branch preview is too broad. Only trust
scripts within the approved deployment. Same-origin path separation does not
isolate hostile scripts/service workers from one another.

## Native GitHub App connections

GitHub App connections are always available, with no build/update flag or disabled
release mode. The user explicitly requested removal of that switch. Incomplete
device isolation checks remain open under `task-3vt.39.6.3`; capability availability
does not establish physical-device acceptance. Connection permissions and native
document lifetime continue to control which operations an approved page may use.

Configure the hosted **`app/`** HTTPS URL as the deployment:

1. In **GitHub App connections**, enter a connection name, public **GitHub App
   ID** and **client ID**, then **Add GitHub connection**. Users choose their
   Apps; multiple named connections can use different Apps or the same App.
2. Enable device flow and expiring user tokens on that App, install it on the
    repositories you use. Contents read permits browsing; Contents **read and write**
    is required to save review drafts/responses. Workflow delivery requires Actions
    write on the configured trusted source repository, and progress requires Actions
    read there. The engine rejects unrelated write permissions. After changing App
    permissions, approve the installation update and select it again in Alohak.
3. Tap **Start GitHub sign-in**, then **Open GitHub verification**. Enter the
   displayed user code at GitHub in the system browser. Polling resumes while
   Alohak is in the foreground; **Check sign-in** retries explicitly after an
   error. No client secret or App private key is requested.
4. **Load installations**, select the intended installation, optionally **List
    repositories**, then **Grant this deployment GitHub access** for that
   connection. Repeat separately for other connections. Fixture/page-storage
   approvals do not grant GitHub access.
5. Reload the hosted page, select the approved connection and private storage
   repository, discover a workspace, browse its manifest and read a document.
   Git blob identity/bytes are verified by the hosted reader. Alohak waits for
   the native bootstrap and uses `github.request`; it does not fall back to an
   extension when native startup fails.

Connection discovery, repository/probe/Git reads, workspace navigation preferences,
explicit review draft saves, immutable response submission and exactly correlated
workflow progress are available through this transport. General S3 operations,
sign-in, grant changes, arbitrary fetch and token export are unavailable to the
GitHub page RPC. The separate bounded native Pi transport supports inference and
Pi S3 conversation list/read/checkpoints, as described below.
Private document bytes are intentionally visible to approved deployment scripts.

Review writes use the shared reviewer identity, deployed-app/receiver pinned request/form validation,
draft compare-and-swap, non-force Documents ref updates and verified readback.
Only submitted process-bound responses dispatch workflows; drafts do not. Larger
review payloads use `github.reviewTransfer` with strict review-only metadata,
ordered 2,048-character chunks and a 256,000-byte artifact limit. Native ingress
stays **16 KiB per message**. At most two transfers can wait for 60 seconds;
navigation/document invalidation and connection revocation clear them. Authority
is checked again before each Git mutation, including after storage/token awaits.
Explicit remote draft saves are supported; automatic cross-device draft sync
remains deferred. Automated fixtures cover the full native-broker draft/submit/
progress path without WebCrypto or browser text codecs; signed-device review
write acceptance remains a separate check.

Connection metadata, installation choices and per-connection directory grants
persist in AsyncStorage. Access/refresh tokens and pending device codes are
stored only in Expo SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS).
SecureStore's config plugin excludes Android credentials from backup. Restored
metadata without its secret requires fresh sign-in, installation selection and
grants. Locked/unavailable secure storage fails without a plaintext fallback.
Page key/value data uses a separate exact-origin namespace.

Each secret update writes a new secure generation before committing its metadata
pointer, then deletes the old generation. An interrupted or failed update may
require explicit reconnection, particularly after upstream refresh rotation;
unreachable orphan secrets can remain if OS deletion fails. Disconnect/remove
make credentials unreachable locally; revoke upstream authorization in GitHub
settings when needed. Upstream revocation may affect other connections to the
same App. Installation changes and grant revocation suppress pending results
immediately. There is no implicit switch to another connection or installation.

On cold launch, the confirmed deployment and its fixture/storage approvals now
restore automatically; GitHub credentials/grants persist separately. Verify
restart, automatic expired-token rotation, **Refresh credentials**, revocation
during a read, and disconnect/remove for one connection while another still
works. These require physical-device proof, not just the fixture tests.

## Native ChatGPT and Pi connections

Native settings expose **Connect to ChatGPT** alongside the existing custom
inference and S3 connection forms. Choose a connection name and model, connect,
then open the system-browser verification page and enter the selectable code.
Device-code login must be enabled for the ChatGPT account/workspace. Alohak polls
only while settings are open in the foreground; pending login survives settings
reopening and app restart. Backgrounding hides codes, including late responses.
Use **Check ChatGPT sign-in** or **Retry ChatGPT settings** after a failure, or
cancel/restart the sign-in. Interrupted token exchange/rotation requires explicit
reconnection rather than replaying uncertain credentials.

Each ChatGPT connection supports model changes, explicit hosted origin/directory
grants, saved-grant revocation, reconnect, local disconnect and removal. Grant
access independently for each connection; the current-deployment shortcut only
fills the origin/directory fields. The hosted page receives public descriptors,
never the settings/auth operations or credentials. Disconnect removes local
credentials; upstream session revocation belongs in ChatGPT security settings.

The provider is the pinned Pi Codex device protocol and fixed Codex Responses
route, with no fallback to a different account, public API endpoint or billing
provider. Model entry does not prove entitlement. Full ChatGPT auth, including
pending codes and interrupted-exchange/rotation markers, joins private URLs and
headers in SecureStore generation chunks. Existing custom endpoint records retain
their identity, credentials and grants. Read/retry/navigation do not clear Pi
operations; settings mutations invalidate pending transfers and active inference.

The separate native Pi transport provides bounded inference open/read/cancel and
S3 conversation list/read/checkpoint operations. Generic `s3Upload` remains
unsupported; these controls do not imply a general native S3 file browser/upload
transport. Existing S3 configuration editing/credential rotation and broader native
settings parity are follow-up work.

Automated coverage exercises the production secure record schema/store, auth and
native Pi RPC without browser crypto/text codecs/TransformStream, and the actual
settings hook/view with DOM native-control/AppState shims. Those UI rehearsals cover
phone/tablet portrait/landscape, split-width resizing, background/resume, late
responses, settings reopen, model changes, grants, cancel and local disconnect.
They do not establish native layout, VoiceOver, keyboard/OS Back or installed iOS
acceptance. Real ChatGPT sign-in, model eligibility, inference/tools and refresh
still require an eligible account and installed-device verification.

## Finding the deployment URL

The deployment URL is the **hosted website Alohak should load**, not a GitHub
repository URL, Expo build/install link or `alohak://` handoff link. Normally your
agent supplies the complete URL to paste into **HTTPS entry URL**, followed by
**Set deployment**. The app saves that confirmed value and restores it after
restart. Setting a new URL does not approve fixture, storage or GitHub access.
If you do not have a deployment URL, ask your agent for the current verified
hosted application link before configuring the app.

For this workspace's current branch preview:

- Main application:
  `https://mickmister.github.io/github-ultimate/previews/b-vk-46e5-vd-multi-instanc-0940c2d95906d253/app/`
- Bridge/storage validation page:
  `https://mickmister.github.io/github-ultimate/previews/b-vk-46e5-vd-multi-instanc-0940c2d95906d253/mobile-proof.html`

These are examples for this branch, not universal defaults. An agent should use
the successful Pages run/published preview manifest and verify the preview's
`build.json` branch/source SHA before handing off its URL. Do not invent a preview
hash or copy a stale URL from another task. Label the main app and validation URLs
separately and tell the user which one to use for the immediate step.

## Songdrive reference and differences

Reviewed `~/repos/songdrive/apps/mobile/{App.tsx,app/main_webview.tsx,app.config.ts}`.
Reused the ideas of an Expo app, registered scheme, initial/warm link handling
and JSON-serialized native-to-page messages. This implementation uses remote
HTTPS rather than local HTML assets, and no Springboard engine. It does not
carry over wildcard origins, file access, shared third-party cookies or
debugging permissions. The native contract now lives in a pnpm patch on RNWV;
see [mobile-webview.md](mobile-webview.md). Native back/forward buttons are
provisional pilot controls alongside the external Reload button.

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
  errors are never bypassed. Blocked external URLs are not auto-opened; native
  settings open fixed GitHub verification/installation URLs only on user action.
- Replies use imperative, request/frame-bound native commands, not a shared
  React response prop: iOS resolves the original
  `WKScriptMessageHandlerWithReply` promise; Android replies through the
  sending frame's `JavaScriptReplyProxy`. At most eight native replies are
  pending; navigation/failure/disposal invalidates them. Bootstrap evaluation
  still checks a document ID and needs lifecycle/race verification on devices.
- The bundled TypeScript broker rechecks the native context and current grant
  for every call, including discovery. Fixture methods are synchronous. Page
  storage is asynchronous, serialized, and rechecks the storage grant and
  document generation before and after persistence. An in-flight write may
  already commit when revocation occurs; its result is suppressed and the
  client must explicitly reopen rather than replay it. Requests
  must be JSON-RPC 2.0 with a bounded string ID/named params, <=16 KiB UTF-8;
  echo is <=1024 characters. Batches, notifications, unknown methods/fields and
  incompatible protocol versions are rejected. The page adapter bounds pending
  calls at eight, times them out and discards stale generations. GitHub calls
  use the connection's own grants and recheck native context and revocation
  generation before/after work and before disclosing results.
- Native settings cannot be opened/approved through page RPC. Losing active focus
  invalidates pending broker work, but ordinary foregrounding keeps the WebView
  and page state alive. Only the latest native-ready document is reactivated;
  a broker epoch prevents old storage/GitHub work from reviving even when the
  document ID is unchanged. Deployment changes still replace the view. Reload is the
  recovery path for process failure. Native settings remain available if the
  remote page fails. Native back navigation, download/file-picker integration
  and full offline persistence are not claimed by M1.

The displayed `extra.buildCommit` does not change native APIs and is omitted from
fingerprinting. All other configuration, native dependencies and explicit WebView
patch bytes remain hashed. Removing the former GitHub feature-switch metadata and
fingerprint normalization changes compatibility, so this migration needs a matching
native binary. Later releases have no GitHub enable/disable option.

The UA marker suppresses handoff UI and selects the native transport before
bridge initialization; it is not an authorization signal. Neither an injected nonce nor page-side checks
replace the native trust boundary. Approved-page scripts can see everything
their methods return. GitHub-enabled testing and outstanding device-isolation
evidence are tracked separately under the user's explicit release decision.

## Custom-scheme pilot

The proof page offers **Open in app**, **Stay on web**, and an opt-in preference
for a single automatic attempt on a future mobile visit. There is no repeated
retry or installed-app detection; a tap may still be necessary. The automatic
preference stores only a boolean. It is suppressed inside Alohak even
before the bridge becomes ready.

The production hosted `app/` now offers **Open in Alohak** above every route in
mobile browsers, including review and revision-pinned document links from chat.
It keeps the full physical deployment path, query and hash route, and updates
when navigating inside the hosted app. The action is hidden inside Alohak and
on ordinary desktop browsers. It uses an explicit tap, with a browser fallback
message; there is no automatic redirect or installed-app detection.

For first-time setup, install the preview and set the native HTTPS entry URL to
the displayed `app/` deployment, then return to the browser link and tap the
action. A deployment still configured for `isolation/` cannot open sibling
`app/` routes; configure `app/` explicitly. Changing deployment resets its grants.
The handoff grants no GitHub/storage access. Full end-to-end OS launch from chat
and cold/warm app routing still need installed-device verification on each OS.

Links look like:

```text
alohak://open?route=%2Fproject%2Fpreview%2Fapp%2F%3Fworkspace%3Da%23%2Fdocuments
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
xcrun simctl openurl booted 'alohak://open?route=%2Fproject%2Fpreview%2Fmobile-proof.html'
adb shell am start -a android.intent.action.VIEW -d 'alohak://open?route=%2Fproject%2Fpreview%2Fmobile-proof.html' dev.alohak.mobile
```

Use your configured directory in place of `/project/preview/`. A future
Universal/App Link implementation needs controlled root association-file
hosting; no domains/association files are provisioned here.

## Checks and remaining acceptance

Use the [credential-free isolation harness](mobile-isolation.md) at
`isolation/index.html` for source/nonce-correlated raw-frame probes, out-of-order
replies, delayed revocation and copyable per-device evidence. It requires the
bundled `fixture.delay` capability for delayed probes, and explicitly leaves
silence and unperformed manual lifecycle/redirect checks inconclusive.

Manual cloud builds and installed-shell OTA updates are available through the
[EAS dispatch workflows](mobile-eas.md). Updates require an EAS-enabled native
build and a matching native fingerprint. SecureStore, Expo Crypto and the new
native reply API and patched RNWV require a new matching binary before testing these changes;
an OTA-only update cannot add them to an older shell.

```sh
pnpm run check
pnpm --dir mobile run check
pnpm exec vitest run tests/mobile-alohak.test.ts tests/mobile-github.test.ts tests/page-storage.test.ts
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
`mobile-build-local.yml` compiles the Android debug app and iOS simulator app in
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
| Concurrent replies completed out of order; navigation during completion | Each original caller receives only its own result; no replacement-document disclosure |
| GitHub restart/refresh rotation and independent connection grants | Private document reads succeed only through the explicitly selected approved connection |
| GitHub revocation/disconnect during queued or pending reads | Result suppressed; other connections remain independent |

The signed/device round trip remains unaccepted. Unit tests cover secure-store
restart/rotation/failure and policy checks; the browser native-RPC fixture reads
a private document through the shared broker without exposing credentials.
Neither launches the native WebView or proves actual GitHub authorization on a
device. General S3 transport, mobile Dolt WASM viability and App Store acceptance
remain separate; the bounded native Pi S3 path is implemented.

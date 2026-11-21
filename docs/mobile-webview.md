# Alohak WebView dependency and native contract

The accepted `alohak_rnwv_pnpm_migration_v1` response on Bead
`task-3vt.39.6.9` selects both-platform migration to **react-native-webview
13.15.0**, Expo SDK 54's compatible release, using **pnpm patch**. The narrow
native contract is preferred; deeper changes are acceptable if understandable
and they reduce duplicated browser implementation. No independent fork or
Expo/React Native major upgrade is introduced.

`mobile/AlohakWebView.tsx` is the app facade. RNWV owns view creation/layout,
navigation commands, platform UI and React Native integration. The former local
Expo WebView module is removed. Native settings, the broker, GitHub credentials,
connection grants, workspace cache and page-storage data keep their existing
formats. The provisional native Back/Forward controls sit beside Reload, using
RNWV navigation state; they do not determine broker authority. Reload remains
available outside a broken hosted page and preserves browser history. Songdrive's
mobile wrapper informed this arrangement; a curated hosted navigation UI remains
possible later.

## App-private opt-in patch

`patches/react-native-webview@13.15.0.patch` adds `AlohakBridge.java` and
`RNCAlohakBridge.{h,m}`, with small lifecycle/command hooks in RNWV. The app's
native `injectedJavaScriptObject` configuration carries `alohakScope`. This
**native prop**, not a page message, enables the mode for that mounted view.
The facade is keyed/remounted when the configured deployment changes. Unrelated
RNWV instances keep upstream behavior. No codegen prop/event schema is forked.

In this mode:

- Native navigation permits only the configured HTTPS origin/directory and
  rejects encoded separator/dot traversal, external/subframe navigations and
  popups. Native policy bypasses RNWV's asynchronous JS navigation decision and
  automatic external-URL handoff. The facade denies that JS fallback as well.
- The ordinary `ReactNativeWebView` page-message path is disabled. Android
  removes its stock listener/interface, uses an exact-origin AndroidX `alohak`
  listener with source-origin/main-frame checks, and never falls back to
  `addJavascriptInterface`. iOS rejects ordinary message-handler forwarding
  and uses the `alohak` WK reply handler with native frame/security-origin checks.
- Only native-generated document/message envelopes reach the app facade.
  General RNWV navigation events update buttons, never activate the broker.
  Changing native configuration cancels the previous bridge before replacing it,
  including when RNWV recycles a native component for another deployment.
  Original-document identity is captured from the iOS main response before
  execution or Android page-start URL. History API updates do not promote grants.
- Navigation/failure/process loss/disposal invalidate pending requests. iOS
  callbacks correlate `WKNavigation` identity; Android readiness requires a
  matching commit URL. Platform callback ordering/races still need device proof.
- RNWV's native `postMessage` command accepts a JSON
  `{documentId, replyId, data}` envelope and resolves the original WK promise or
  Android reply proxy. It does not inject response-bearing JavaScript. At most
  eight requests are pending and request payloads are capped at 16 KiB UTF-8.
- RNWV's `injectJavaScript` command accepts the existing app-owned
  `{documentId, script}` bootstrap envelope; native checks readiness/generation
  before evaluation. This command is not exposed through page RPC.
- Android popups, download dispatch, file chooser and media permission requests
  are disabled in opt-in mode. The facade disables file access, mixed content,
  third-party/shared cookies, geolocation and iOS media permission grants. This
  migration does not add general browser integrations.

The special command semantics are intentionally encapsulated in the facade;
callers must not use raw RNWV messaging APIs on an Alohak-mode view. A missing
patch is not a supported configuration. Frozen installs must fail on invalid
patches, and both native CI builds must pass before publishing a matching binary.

## Editing and upgrading the patch

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm patch react-native-webview@13.15.0
# Edit only the extracted directory printed by pnpm, then:
pnpm patch-commit <printed-edit-directory>
```

Use `apply_patch` or normal source editing in that extracted directory. Do not
edit pnpm's shared installed package/store in place. Commit the generated patch,
`pnpm-workspace.yaml`, lockfile and app dependency changes together. Clean CI/EAS
installs apply the patch before autolinking/prebuild; app native directories are
generated rather than patched. EAS uploads must include the workspace-root patch
and manifests; no `.easignore` excludes them.

`mobile/fingerprint.config.js` explicitly hashes the patch file bytes in addition
to Expo's native dependency/autolinking inputs. Tests check both platforms include
that source and the patched RNWV dependency. Native patch changes require a fresh
matching binary; an OTA update cannot add these native handlers/commands.

At dependency upgrades, recheck the RNWV hooks, native source/event paths and
defaults. A successful textual patch application alone does not prove semantic
compatibility. Run clean install, dependency validation, fingerprint checks,
prebuild, Hermes exports, type/unit/browser checks and iOS/Android compilation,
then repeat the signed-device probes in [mobile-alohak.md](mobile-alohak.md).
Include switching deployments across native view recreation/recycling and binary
or malformed page messages in those probes.

## Delivery and acceptance

The response authorizes CI first, then internal EAS preview builds for both
platforms only after the relevant CI runs pass. Preserve exact source/run/build
IDs. Register one `vibe-agent callback` per turn when waiting on hosted work.
EAS dispatch exposes `github_connections`, default `0`, so testing does not
depend on an unknown repository-secret flag. No store submission or production
OTA rollout is part of migration.

Implementation completion and device acceptance are separate: source/automated
parity can finish while `task-3vt.39.6.3` awaits physical-device evidence. GitHub
sign-in remains default-off. Neither a native compile nor a mocked browser bridge
establishes actual WebView isolation, device-flow authorization or restart/refresh
behavior with real credentials.

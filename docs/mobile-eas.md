# Manual EAS builds and updates

Based on `mickmister/handy-actions` branch `vk/ddd8-lock-screen-acti`:
`build_mobile.yml`, `update_mobile.yml`, their composite actions, app config and
`eas.json`. Both Alohak release workflows run **only on workflow_dispatch**:

| Workflow | Choices | Result |
| --- | --- | --- |
| `mobile-build-eas.yml` | all/android/ios; development/preview/production | Cloud EAS Build, waits for completion; links + JSON artifact |
| `mobile-update-eas.yml` | all/android/ios; development/preview/production; message | EAS Update to matching channel/environment; links + JSON artifact |

The workflow ref is the source being released. No automatic store submission
is included. Build failure/publish failure fails the job; CLI diagnostics are
not suppressed. Production builds are store-distribution artifacts, not store
submissions. The existing push-triggered native compilation workflow remains
credential-free and independent.

## One-time setup

The app config defaults to Alohak project
`c198f19d-590b-4362-85f8-9e48c34db45a`, slug `alohak`. The release helper
requires explicit project/owner settings so dispatched builds and updates use
the same project. Configure these repository settings:

| Setting | Kind | Meaning |
| --- | --- | --- |
| `EXPO_TOKEN` | GitHub Actions secret | Expo token authorized to build/publish this project |
| `EXPO_PROJECT_ID` | GitHub Actions secret | Expo project UUID |
| `EXPO_OWNER` | GitHub Actions secret | Expo account/organization owning the project |
| `EXPO_PUBLIC_ALOHAK_URL` | Optional GitHub Actions secret | Public HTTPS entry URL to prefill native settings; does not grant access |
| `EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS` | Optional GitHub Actions secret | Public feature flag: unset/`0` disables GitHub sign-in/reads; `1` enables only after signed-device isolation acceptance |

The runtime connection credentials remain device-local. `EXPO_TOKEN` is release
authentication, not GitHub OAuth/S3 credentials or a managed runtime auth backend.
It is passed only to the release step and never written into app config.
Missing settings fail with a specific error rather than provisioning an account
or project implicitly.

Run EAS credentials setup interactively once with access to the Expo/Apple/
Google accounts, using the selected project configuration:

```sh
pnpm install --frozen-lockfile
```

Then, from `mobile/` with `EXPO_PROJECT_ID`, `EXPO_OWNER` and your Expo login/token
available:

```sh
pnpm exec eas credentials --platform ios
pnpm exec eas credentials --platform android
```

Internal iOS builds need a provisioned device list/Apple signing configuration.
The non-interactive workflow cannot answer missing credential prompts. Native
identifiers are `dev.alohak.mobile`; configure matching credentials before
public distribution. Development builds include
`expo-dev-client`; preview produces an internally distributed app (Android APK),
and production produces store builds. Expo usage/queue limits apply.

The helper temporarily injects only public project/owner/entry/feature configuration
into `eas.json`'s inherited base profile before EAS uploads the worktree. This
ensures EAS cloud workers receive the same values as the dispatch runner, even
though GitHub secrets are not automatically present on EAS. It restores the
file after command completion/failure. Do not configure contradictory project,
owner, entry or feature values in EAS environments. The environment for each build and
update is explicitly the selected profile name.

## Dispatch

Use Actions' **Run workflow**, selecting the integration branch, or:

```sh
gh workflow run mobile-build-eas.yml --repo mickmister/github-ultimate \
  --ref vk/46e5-vd-multi-instanc -f platform=all -f profile=preview

gh workflow run mobile-update-eas.yml --repo mickmister/github-ultimate \
  --ref vk/46e5-vd-multi-instanc -f platform=all -f profile=preview \
  -f message='Alohak fixture update'
```

GitHub requires a workflow_dispatch workflow to exist on the repository's
default branch before dispatch is available. If these workflow files are only
on the integration branch, merge their definitions into the default branch as
part of normal repository review, then dispatch with the desired source ref.
Pushing this feature alone does not authorize changing the default branch.

Build JSON includes build IDs; update JSON includes update groups. The workflow
summary points to the Expo build/update/project, and a seven-day JSON artifact
preserves the CLI receipt. An EAS build link is not physical-device acceptance.

## Update boundary and compatibility

`expo-updates` is enabled only when an Expo project ID is configured. The update
URL is `https://u.expo.dev/<project-id>`. Native runtime compatibility uses
Expo's **fingerprint** policy, matching the reference repository. Changing
native adapter sources/dependencies requires a new matching binary; an OTA
update cannot add Swift/Kotlin methods to an installed app. A new dependency or
fingerprint means an update may publish successfully yet reach no old clients.
Build first when native compatibility changes.

Origin-scoped page storage adds the native AsyncStorage dependency. Install a
new matching build before testing that feature; an OTA-only update of an older
fixture binary cannot supply it. See [page-storage.md](page-storage.md).

Native GitHub connections add `expo-secure-store`, `expo-crypto`, and imperative
request/frame-bound reply methods in both native adapters. Install a fresh
matching binary before testing them. The default-off feature flag does not
replace the outstanding signed-device checks in [mobile-alohak.md](mobile-alohak.md).

The installed React Native JavaScript, including native-screen/policy logic,
can now be changed by an authorized EAS update. This supersedes M1's original
OTA-disabled setting. EAS release access is therefore part of the trusted app
delivery boundary. Remote Pages JavaScript still cannot approve grants or
receive connection secrets, and the native WebView gate remains in the binary.
EAS updates are separate from ordinary remote GitHub Pages UI deployments.

The previously compiled M1 binaries without `expo-updates` cannot receive this
feature via OTA: install a new EAS-enabled binary first. Development clients
normally use Metro/dev tooling; preview/release builds establish actual OTA
download/application behavior. S3 remains unavailable on mobile; GitHub sign-in
and read methods are separately gated pending device isolation acceptance.

## Verification scope

Local checks cover dispatch-value validation, shell-free CLI argument handling,
required setup, credential-free uploaded config, profile/channel/environment
alignment, Expo config/prebuild/export and fingerprint generation. CI compiles
the resulting native sources. Actual EAS cloud build/publication, installation,
matching-runtime update download/relaunch, and account-specific signing require
the project/token/credentials above. Record those build/update IDs before
claiming end-to-end EAS delivery.

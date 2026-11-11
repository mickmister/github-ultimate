# Manual EAS builds and updates

Based on `mickmister/handy-actions` branch `vk/ddd8-lock-screen-acti`:
`build_mobile.yml`, `update_mobile.yml`, their composite actions, app config and
`eas.json`. Both companion release workflows run **only on workflow_dispatch**:

| Workflow | Choices | Result |
| --- | --- | --- |
| `build-mobile.yml` | all/android/ios; development/preview/production | Cloud EAS Build, waits for completion; links + JSON artifact |
| `update-mobile.yml` | all/android/ios; development/preview/production; message | EAS Update to matching channel/environment; links + JSON artifact |

The workflow ref is the source being released. No automatic store submission
is included. Build failure/publish failure fails the job; CLI diagnostics are
not suppressed. Production builds are store-distribution artifacts, not store
submissions. The existing push-triggered native compilation workflow remains
credential-free and independent.

## One-time setup

Create/select an Expo project **for this companion**, with slug
`github-ultimate-companion` (do not reuse Handy Actions' project ID). Configure
these repository settings:

| Setting | Kind | Meaning |
| --- | --- | --- |
| `EXPO_TOKEN` | GitHub Actions secret | Expo token authorized to build/publish this project |
| `EXPO_PROJECT_ID` | GitHub Actions variable | Expo project UUID |
| `EXPO_OWNER` | GitHub Actions variable | Expo account/organization owning the project |
| `EXPO_PUBLIC_COMPANION_URL` | Optional GitHub Actions variable | Public HTTPS entry URL to prefill native settings; does not grant access |

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
identifiers are currently `dev.githubultimate.companion`; select final IDs and
matching credentials before public distribution. Development builds include
`expo-dev-client`; preview produces an internally distributed app (Android APK),
and production produces store builds. Expo usage/queue limits apply.

The helper temporarily injects only public project/owner/entry configuration
into `eas.json`'s inherited base profile before EAS uploads the worktree. This
ensures EAS cloud workers receive the same values as the dispatch runner, even
though GitHub variables are not automatically present on EAS. It restores the
file after command completion/failure. Do not configure contradictory project,
owner or entry values in EAS environments. The environment for each build and
update is explicitly the selected profile name.

## Dispatch

Use Actions' **Run workflow**, selecting the integration branch, or:

```sh
gh workflow run build-mobile.yml --repo mickmister/github-ultimate \
  --ref vk/46e5-vd-multi-instanc -f platform=all -f profile=preview

gh workflow run update-mobile.yml --repo mickmister/github-ultimate \
  --ref vk/46e5-vd-multi-instanc -f platform=all -f profile=preview \
  -f message='Companion fixture update'
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

The installed React Native JavaScript, including native-screen/policy logic,
can now be changed by an authorized EAS update. This supersedes M1's original
OTA-disabled setting. EAS release access is therefore part of the trusted app
delivery boundary. Remote Pages JavaScript still cannot approve grants or
receive connection secrets, and the native WebView gate remains in the binary.
EAS updates are separate from ordinary remote GitHub Pages UI deployments.

The previously compiled M1 binaries without `expo-updates` cannot receive this
feature via OTA: install a new EAS-enabled binary first. Development clients
normally use Metro/dev tooling; preview/release builds establish actual OTA
download/application behavior. This work does not introduce GitHub/S3 methods
or bypass pending device isolation acceptance.

## Verification scope

Local checks cover dispatch-value validation, shell-free CLI argument handling,
required setup, credential-free uploaded config, profile/channel/environment
alignment, Expo config/prebuild/export and fingerprint generation. CI compiles
the resulting native sources. Actual EAS cloud build/publication, installation,
matching-runtime update download/relaunch, and account-specific signing require
the project/token/credentials above. Record those build/update IDs before
claiming end-to-end EAS delivery.

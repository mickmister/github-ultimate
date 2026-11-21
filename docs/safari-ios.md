# Safari on iOS: code now, Xcode packaging later

The shared extension implements forms, wizard navigation, zen view, local drafts,
response history, and manual GitHub comment composition for mobile Safari.
Build its WebExtension resources on Linux, macOS, or CI:

```sh
pnpm install --frozen-lockfile
pnpm run build:safari
```

`dist-safari/` contains the manifest, bundled content/settings scripts, popup,
and license notices. It is **not an installable iOS app**. Xcode host-app
creation, bundle identifiers, signing, distribution, and real-device acceptance
are deferred. No Apple credentials or Mac are required for the code checks.

## Browser targets and current evidence

| Target | Delivery / verification |
| --- | --- |
| Desktop Chrome/Chromium 120+ | Existing `dist/` extension, loaded as an actual unpacked extension in automated tests |
| Safari on iPhone/iPad | `dist-safari/` targets Safari 16.4 JavaScript syntax; signed app packaging and minimum-OS validation still required |
| Automated mobile WebKit | Current Playwright WebKit with iPhone and iPad device profiles; real Safari bundle with a test-only storage adapter |
| Automated mobile Chromium | Same mobile workflow and Safari bundle; regression evidence for the shared code |
| Chrome on iOS | No desktop Chrome-extension installation path; this implementation targets Safari WebExtensions |

Safari 16.4 / iOS 16.4 is the intended baseline, not a claim of testing against
that OS. Esbuild transforms syntax, not browser APIs. The code uses native
Shadow DOM, modal dialogs, Web Crypto, structuredClone, VisualViewport and
extension-local storage. There is no background worker, OAuth, continuous
monitoring, or native messaging requirement in this slice.

## Compatibility and mobile behavior

- Prefer promise-based `browser.storage` on Safari, with `chrome.storage` for
  Chromium. Both settings and drafts use the same narrow adapter.
- Drafts retain source-revision binding. Saves snapshot mutable answers and run
  in order. `visibilitychange` to hidden, `pagehide`, and SPA teardown flush
  pending edits instead of relying on a timer surviving tab suspension.
  Mobile OS process termination can still interrupt storage; no asynchronous
  page-exit write can guarantee recovery after an abrupt kill.
- Zen captures stable outer bounds when opened. Keyboard-sized and offset visual
  viewports adjust only its inner scroll window and control positions, rather
  than shrinking/recentering the modal on every keyboard animation frame.
  Orientation changes can resize it. Workspace panels use visual-viewport
  dimensions. Neither changes GitHub's viewport meta tag or disables zoom.
  Safe-area padding protects edge controls.
- Narrow or touch-oriented views use 44px controls and 16px text fields,
  including notes/previews. Floating entry controls hide during text entry.
- The native modal keeps the focused form separate from GitHub; the same card,
  values and wizard position move between inline and zen views.
- Persistence is a separate snapshot-only module. Normal saving/restoration is
  silent; only a failed save produces a message. IME composition is not
  processed by persistence while typing, and save completion never replaces
  input values, changes selection, or rerenders the form.
- Clipboard denial leaves a selectable preview and manual-copy instructions.
  The legacy copy fallback selects a temporary field inside the active modal
  and restores focus. Clipboard success is not required to submit a response.
- Editor insertion preserves existing text, dispatches native input/change
  events, focuses the editor and never clicks GitHub's Comment button. A form
  becomes submitted only when a matching posted response is discovered. The
  sticky pending prompt hides during preview/native composition and submission.
- On page restoration/foregrounding the content script rescans loaded records.
  No keepalive service or continuous background polling is assumed.

## Local checks

```sh
pnpm run check
pnpm test
pnpm run build
pnpm run build:safari
pnpm exec playwright install --with-deps chromium webkit
pnpm run test:browser
pnpm run test:mobile
pnpm run test:playground
```

Mobile tests load the **built Safari content script** against controlled
GitHub-shaped pages. Only extension storage is substituted, using a `browser`
namespace (no `chrome` global). Tests cover touch navigation, notes, generated
intent, preservation/manual submission of a native draft, confirmed response
history, pagehide draft recovery, source-revision separation, portrait/landscape
and small viewports, stable modal bounds with simulated visual-viewport keyboard
geometry, IME text/selection preservation, automatic Other draft recovery, and
clipboard denial. They do not load a Safari extension or emulate an actual iOS keyboard.
CI retains `dist-safari/` as the `safari-webextension-resources` artifact.

## Later: Xcode and real-device acceptance

On a Mac, build the resources, then use Apple's Safari Web Extension converter
to create the host app project (consult `xcrun safari-web-extension-converter
--help` for the installed Xcode version):

```sh
xcrun safari-web-extension-converter ./dist-safari
```

Choose/configure the iOS target, signing team and bundle identifiers in Xcode.
Install on an iPhone/iPad, enable the extension in Safari settings, and grant
access to github.com. Verify on real authenticated GitHub pages:

1. PR **and issue** forms, mobile GitHub navigation and lazy-loaded comments.
2. Touch choices/notes, wizard/review, portrait/landscape and larger text.
3. Zen with the real software keyboard, scrolling, safe areas, dismissal,
   external-keyboard Tab/Escape and native editor focus after insertion.
4. Background/foreground, back/forward restoration, reload and reopening with
   drafts intact; fresh source revisions must remain separate.
5. Copy when permitted and manual fallback when denied.
6. Existing GitHub draft preserved, manual Comment submission, confirmed
   submitted summary and immutable history after reload.
7. Settings popup, disabled rendering, persistence opt-out, clear-drafts action
   and actual Safari extension-storage behavior.

Record tested OS/device versions and any required fixes before declaring Safari
iOS delivery complete. Desktop and automated WebKit checks are supporting
evidence, not substitutes for this signed-device round trip.

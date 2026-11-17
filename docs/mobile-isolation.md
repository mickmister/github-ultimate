# Credential-free Alohak device isolation harness

The published `isolation/index.html` page exercises the installed scoped native
bridge without GitHub sign-in, tokens, network fetch authority or private data.
Keep the release's `github_connections=0`. Device acceptance belongs to
`task-3vt.39.6.3`; a compiled app or green mocked browser test does not accept it.

## Setup on both platforms

1. Install the current compatible preview bundle/binary supplied by the agent.
   The app's fixture discovery must advertise `fixture.delay`; older binaries
   still run some probes but cannot exercise delayed replies. This method is
   bundled React Native JS; it needs a compatible app update, not just new Pages
   files. Use the fingerprint/release checks in [mobile-eas.md](mobile-eas.md).
2. Set the deployment to the **complete `isolation/index.html` URL**, rather than
   the preview root or `mobile-proof.html`. Its directory narrows native scope to
   `/isolation/`, leaving the sibling outside-scope fixture unapproved. For this
   workspace's preview the URL is:

   `https://mickmister.github.io/github-ultimate/previews/b-vk-46e5-vd-multi-instanc-0940c2d95906d253/isolation/index.html`

   The agent must verify the preview `build.json` SHA before supplying this link.
3. Enable only **Approve fixture bridge**. Page storage and GitHub grants are not
   required. Enter device model/OS and installed build/source in the page fields.
   Android evidence also needs the Android System WebView version. The report
   distinguishes the hosted build from the user-entered installed build.

## Automatic checks

Tap **Run automatic checks**. It runs approved main-frame controls before and
after negative probes, concurrent delayed echoes expected in fast/middle/slow
completion order, same-origin, `srcdoc`, sandboxed opaque-origin and nested frame
calls against raw native endpoints (not merely the main-frame bootstrap), malformed
and forged requests, oversized/binary input and stock-endpoint presence.

An approved document changing its History URL remains the original authorized
document. That positive control is **not** evidence that an unapproved original
document cannot promote itself. Test the separate outside fixture below.

The optional different-HTTPS-origin field needs a separately hosted copy of the
built `isolation/frame.html` and its referenced hashed JS/shared chunks. Keep the
same relative asset layout; permit script CORS for opaque-origin `srcdoc` probes.
The frame echoes only synthetic text and sends a source/nonce-correlated report.
An opaque sandbox is cross-origin, but does not substitute for a second HTTPS
origin. Without that fixture the HTTPS-origin check remains inconclusive.

**Silence, missing assets, blocked scripts, old app capabilities and absent
top-level bootstrap are inconclusive, never a successful denial.** Android may
silently discard invalid input; retain that observation and use native inspection
if explicit rejection cannot be observed. An explicitly rejected frame request,
or a running frame confirming no endpoint exists, provides stronger evidence.
The page never computes an overall acceptance decision or changes feature flags.

## Revocation and lifecycle

- Tap **Start delayed revocation check**, turn off the fixture grant within eight
  seconds without reloading, and wait. The pending response must be a denial;
  synthetic payload success after a timely revocation is a failure. Re-enable
  approval and rerun the main-frame control. Missing/timeout replies alone remain
  inconclusive. Revoking then regranting must not revive an old pending request.
- Tap **Start delayed lifecycle marker**, record its old native document ID and
  unique marker, then use native Reload. Repeat separately for Back/Forward,
   deployment switching/native view recreation. A replacement
  page must have a fresh document ID and must not receive the old success reply.
  A harness page that observes a marker from another load records a **foreign
  lifecycle reply** failure. Lack of that failure alone is not proof: the new
  page may not have loaded its listener before an incorrectly routed reply.
   Returning to the same live page without taking an action is not lifecycle proof.
- Test background/return separately. Ordinary resume must keep the same native
  document ID, page-load ID, form entries and in-memory report; it must not
  deliberately reload. A pending lifecycle marker started before losing focus
  must still be denied or time out, never return its old success after resume.
  Fresh fixture calls must work again. A page actually replaced by navigation or
  OS process loss must instead get a fresh identity. Record the installed update:
  older bundles deliberately remounted on every active transition.
- Repeat with process termination/relaunch. A process-local pending request cannot
  be resumed or implicitly replayed after restart. Native app settings should
  remain usable. Record exact actions and observed native IDs. The in-page report
  is intentionally memory-only; prepare/copy it before leaving a page and record
  the subsequent observation in a new report. It does not pretend to observe a
  disposed page or persist cross-process traces.
- Use the **Unapproved page with earliest History rewrite** link. Native scope
  should block navigation. If the sibling document loads, its first inline script
  rewrites History to the approved URL, then calls the raw echo endpoint. It must
  still be denied. Record whether navigation was blocked or the loaded fixture
  explicitly denied; a failed asset load or lack of a reply is inconclusive.
- Use **Popup attempt**; it must not create a second privileged WebView. Redirect
  to a denied origin/path and encoded-separator cases still require a controlled
  redirect endpoint/native inspection; static GitHub Pages cannot synthesize HTTP
  redirects. Do not mark those cases passed from this page's automatic results.

Tap **Prepare copyable report** and send its contents, including manual actions,
expected/actual results and installed build evidence. No clipboard permission,
automatic upload, credential collection or page-storage grant is required.

## Fixture implementation and verification

`fixture.delay` accepts only named `{ text, delayMs }` parameters: at most 1024
characters, integer delay 0–10000 ms and eight pending fixture calls. It requires
the existing independent fixture grant and current native main-frame document.
It does no I/O. A grant/invalidation epoch prevents revoke/regrant or replacement
from returning an old success; the final echo rechecks current document/grant.
The existing native 16 KiB ingress/eight-pending limits remain intact. It is not
a delayed GitHub API method and grants no additional authority to page scripts.

Unit tests cover correlation/order, frame/path denial, bounds, queue admission,
revocation/regrant and invalidation. Browser tests exercise production page assets,
actual broker delays, frame reports, malicious-frame success detection and missing
capability/bridge reporting using mocked native transport. These are harness
checks, not WKWebView/Android signed-device proof. Record exact native build,
source, device and results before accepting the credential gate.

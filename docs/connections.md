# Client GitHub App authentication proof

The extension includes an opt-in **GitHub App connections** page, linked from the
toolbar popup and available through the browser's extension options. Existing
PR forms still work without authentication. The popup's **Enable PR workspace**
setting toggles the existing GitHub-page UI independently of App connections.

## Configure and test

The add-connection form defaults to `gh-ultimate-browser-extension-auth`:

- App ID: `5684700`
- Public Client ID: `Iv23liGu3PxdoBoqgLiD`
- Device flow enabled; expiring user authorization tokens enabled.
- Contents read; Actions write; no Workflows permission. Additional read
  permissions may be configured. Do not use the writable CI App for this test.

Install the App on the desired accounts/repositories. The initial test targets
the private `mickmister/workspace-storage` repository, with public
`mickmister/github-ultimate`, `mickmister/gh-agentic-workflows` and
`mickmister/workspace-nuggets` also installed. Repository authorization comes from
GitHub; this list is test context, not an extension repository allowlist.

1. Build with `pnpm run build` and reload the unpacked extension from `dist/`.
   The new GitHub/API host permissions may need browser approval.
2. Open the popup's **GitHub App connections** link. Add the default connection.
3. Click **Sign in with device code**, then open GitHub device authorization and
   enter the displayed code. Leave the connections tab open. It polls no faster
   than GitHub's interval and honors `slow_down`. If the tab closes, reopen it to
   resume the persisted unexpired device flow. No secret/private key is entered.
4. After sign-in, **Load installations** and **Use mickmister**. The page displays
   the approved permissions; selecting an installation with write permissions
   beyond Actions is rejected. This detects a mistakenly selected CI App.
5. **List repositories**, then **Read repository** for
   `mickmister/workspace-storage`. Success displays its private flag, default
   branch and immutable head Git object ID. This is an authenticated private
   default-branch ref read, not yet `refs/dolt/data` reconstruction.
6. **Refresh credentials**, then repeat the read. Device-flow refresh uses no
   client secret. Rotated credentials are persisted before further requests.
   Near-expiry credentials also refresh automatically before an API read.
7. Reload the extension and settings page. Repeat the read to test persistence.
8. Add another named connection (another client App if available). Select its
   installation explicitly. Disconnect one locally and verify the other still
   reads. Two entries for the same App are independent local records but may
   share a GitHub authorization; revoking that authorization can affect both.

**Disconnect locally** deletes local tokens and pending device codes, but does
not revoke the authorization on GitHub. Use GitHub's **Settings → Applications →
Authorized GitHub Apps** for upstream revocation. Removed/revoked access is not
silently replaced by credentials from another connection.

## Implementation boundary

OAuth requests and fixed read-only GitHub API calls run in the background
broker. Expiring tokens, refresh tokens and pending device codes live in
extension-origin IndexedDB, not the `chrome.storage.local` area available to
existing content scripts. They are local browser-profile data, not a hardware
vault. Only the exact top-level extension connections page can invoke settings
operations. Approved hosted content scripts may use the bounded read bridge;
external extensions cannot invoke it. Responses contain connection metadata and selected read
results, never tokens or device codes (the non-secret *user* code is displayed).

Each named connection records App ID/client ID, authenticated user and an
explicit selected installation. API operations take a connection ID; there is no
automatic cross-connection fallback. Reads check the installation's current
repository list, not a locally maintained repository allowlist. OAuth calls
omit cookies, reject redirects, time out, and do not log response bodies.

## Multiple Apps, installations and workspace routing

App ID and Client ID identify the **App registration**. Installation ID identifies
one installation of that App on a personal account or organization. Installing
the same App in two organizations does not create new App IDs or Client IDs.
Device flow issues a **user access token** for the App/user authorization. It is
not an installation access token. The broker lists the user's accessible
installations, filters them by App ID, and saves the installation selected with
**Use account**. Repository checks use that saved installation's endpoint.

Each connection currently has one selected installation. Add separate named
connections for multiple installations of the same App (same App ID/Client ID),
or for different Apps. They can coexist. The same App/user may share an upstream
authorization, so revoking it can affect more than one local connection.

Workspace access is implicit in the approved installation's access to the
storage repository. There is no **Bind workspace** setup step or workspace-to-App
assignment. The hosted page carries the selected connection and installation
from discovery into every Git request. Changing that connection's installation
invalidates an already-open route and requires reconnect/discovery; denied or
revoked access never silently switches to another App. If multiple connections
can access the same storage repository, the user's connection choice selects the
route rather than inventing exclusive ownership from overlapping permissions.
Old local workspace-binding metadata is ignored.

Workspace identity remains `(storage repository, namespace)`, with a required
`workspace/manifest.json` document in `refs/documents/<namespace>`. The hosted app
verifies it before opening documents or inspecting Beads storage. Source-repo
memberships are optional; standalone workspaces need a nonblank `purpose`.
Member source repositories do not have to be GitHub repositories, and their
presence does not authorize access to private workspace storage. Exact-origin
grants and GitHub storage-repository access remain the authorization boundaries.

The [hosted bridge demo](hosted-pages.md) exposes approved-connection discovery,
repository listing and a default-branch Git-ref read. Add/revoke exact origin
grants in settings; multiple connections may approve the same origin. Disconnect
also clears that connection's grants. Browser host permission alone does not
grant a connection. Revocation blocks subsequent requests in already-open tabs.
Workflow dispatch still requires a future separate grant and operation.
Actions write is broader than dispatch-only at GitHub's token layer;
no Workflows/Contents write is needed for dispatching existing definitions.

## API request budgets

The broker serializes requests. It observes `Retry-After`, `X-RateLimit-Remaining`
and `X-RateLimit-Reset`, including a successful response that consumes the last
request. Primary cooldowns are shared across connections for the same GitHub
user: these are **user access tokens**, not installation access tokens, so another
App or installation does not provide a fresh independent user budget.
Secondary limits conservatively pause all connections, for at least one minute
and exponentially longer after repeated throttles. Cooldowns persist in
extension-origin storage across background-worker restarts. No automatic retry
loop runs: errors report a retry time, and requests during the cooldown do not
contact GitHub. A normal permission-denied `403` is not treated as throttling.

Repository membership and workspace-ref lists use ETag conditional requests.
Unchanged authenticated `304` responses save primary quota. Immutable Git objects
are reused from an in-memory LRU cache capped at 32 MiB / 256 entries, scoped by
connection, installation and endpoint. Repository membership is still revalidated
before cached objects are served; origin grants are checked on every hosted call.
Disconnect/removal/installation changes clear the connection's cache. No private
object cache is written to disk or shared with the hosted page's browser storage.
Reads are user-initiated; a Dolt reader should reuse pinned object IDs rather than
refetch all tablefiles. External clients can consume the shared user budget, so
the returned headers remain authoritative rather than a hard-coded request count.

References: [GitHub API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
and [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Verification and platform status

Unit tests cover polling limits/slowdown/expiry, token rotation, concurrent
disconnect/refresh, independent connections, installation selection, safe
responses and fixed read-only endpoints. Packaged Chrome tests exercise the real
settings page/background/IndexedDB with simulated GitHub replies. They do not
claim a real GitHub login or private-read acceptance; the steps above require the
user's authorization.

`pnpm run build:safari` produces a Safari bundle using a non-persistent background
script. The page uses the Safari `browser` namespace when available. Real signed
iPhone testing remains required: device login, polling after foreground/resume,
credential persistence, refresh and private read. Safari build success is not
on-device acceptance. No Dolt engine or WASM runs in the extension. The native
WKWebView broker fallback remains a separate experiment if Safari blocks the
required behavior.

Sources: [GitHub App user/device tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[device-flow refresh exception](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens),
[Actions permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-actions).

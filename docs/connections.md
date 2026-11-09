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

1. Build with `npm run build` and reload the unpacked extension from `dist/`.
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
vault. Only the exact top-level extension connections page can message this
prototype broker; GitHub content scripts, hosted pages and external extensions
cannot invoke it. Responses contain connection metadata and selected read
results, never tokens or device codes (the non-secret *user* code is displayed).

Each named connection records App ID/client ID, authenticated user and an
explicit selected installation. API operations take a connection ID; there is no
automatic cross-connection fallback. Reads check the installation's current
repository list, not a locally maintained repository allowlist. OAuth calls
omit cookies, reject redirects, time out, and do not log response bodies.

This slice does not expose a hosted-origin bridge or dispatch operations. A
later bridge must add per-origin connection grants and a separate dispatch
grant. Actions write is broader than dispatch-only at GitHub's token layer;
no Workflows/Contents write is needed for dispatching existing definitions.

## Verification and platform status

Unit tests cover polling limits/slowdown/expiry, token rotation, concurrent
disconnect/refresh, independent connections, installation selection, safe
responses and fixed read-only endpoints. Packaged Chrome tests exercise the real
settings page/background/IndexedDB with simulated GitHub replies. They do not
claim a real GitHub login or private-read acceptance; the steps above require the
user's authorization.

`npm run build:safari` produces a Safari bundle using a non-persistent background
script. The page uses the Safari `browser` namespace when available. Real signed
iPhone testing remains required: device login, polling after foreground/resume,
credential persistence, refresh and private read. Safari build success is not
on-device acceptance. No Dolt engine or WASM runs in the extension. The native
WKWebView broker fallback remains a separate experiment if Safari blocks the
required behavior.

Sources: [GitHub App user/device tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[device-flow refresh exception](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens),
[Actions permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-actions).

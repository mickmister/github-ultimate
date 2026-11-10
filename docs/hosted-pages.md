# Hosted bridge and branch previews

`hosted/` is an independently deployed workspace dashboard with an advanced
settings/read demo. [Dashboard v2](dashboard.md) describes its views and app seam.
It uses the intended split:

```text
Hosted page UI -> window messages -> isolated content script
              -> background broker -> GitHub -> data-only response
```

## Use it

1. Install the matching extension build. Open **GitHub App connections**, sign in
   to a client App, and select an installation.
2. Open a deployed hosted preview. It displays its actual origin. In connection
   settings, grant that exact origin read access and approve the browser host
   permission. Reload the hosted page.
3. The landing page connects automatically and lists manifest-backed workspaces
   discovered through approved installation repositories. Open a workspace card
   to navigate to its detail page. Ambiguous access routes require a choice;
   unavailable saved access never falls back to another connection.
4. The detail page prioritizes **Beads** and provides **Open in github.dev** for
   documents. Beads currently inspects pinned storage metadata; issue queries
   still require an in-browser Dolt engine. **Settings** opens the former page,
   including connection selection, private-read proof, raw discovery, document
   text diagnostics and saved-selection controls.
5. Revoke that origin in settings. New reads in the already-open page must fail.

The reference operations are bounded: `discover`, `connections`, `repositories`,
`probe` (default-branch ref), `gitRefs`, `gitCommit`, `gitTree` and `gitBlob`.
Git reads carry the selected installation ID; commit/tree/blob requests also
include the workspace namespace. Access follows the discovery connection without
manual workspace bindings. Installation changes require reconnect/discovery.
No tokens, login/device-flow operations,
arbitrary HTTP or workflow dispatch are exposed. The page keeps results only in
memory and does not install a service worker. Only navigation selections are
saved in browser storage, as described below. Generic query-only GraphQL, Dolt issue queries and
separate dispatch grants are future slices.

## Returning to a workspace and discovery diagnostics

The page stores a small navigation record in localStorage, isolated by preview
directory: connection ID, selected installation ID, repository, workspace name
and whether discovery had completed. It never persists tokens, document bodies,
manifests, Git trees or read results. The v2 landing page always shows the chooser
and highlights the last workspace. A detail deep link reconnects and verifies its
access route; Settings also retains the prior automatic manifest/document-list
restoration. Individual document contents are not restored from browser storage.
A changed installation or unavailable saved connection asks for an explicit
choice. Unavailable/corrupt browser storage does not prevent manual browsing.

**Clear displayed data** clears in-memory workspace/read results while retaining
the saved selection. **Forget saved selections** removes this preview's record
and clears displayed data. Restoring a workspace performs bounded authenticated
reads through the normal broker/rate limiter; there is no polling loop.

Discovery progress/errors appear on the chooser and in Settings beside
**Discover workspaces**. The isolated relay explicitly rejects incompatible
requests rather than silently dropping them before the background/network layer.
The page verifies a relay revision during the handshake, so an old injected script
reports an actionable update/reload error. Extension startup/update refreshes
existing dynamic script registrations; already-open tabs still need reloading
after an extension update. Production HTML uses content-hashed JS/CSS URLs to
avoid mixing cached assets from different deployments.

## Workspace storage contract

Discovery unions `refs/documents/<namespace>` and `refs/dolt/<namespace>` in the
chosen repository. These are candidate storage namespaces, not a new canonical
workspace registry. Dolt-only recovery refs remain visible, and distinct names
are never merged heuristically. The nugs attachment registry is machine-private;
the `nugs-storage` bootstrap branch is not a workspace catalog.

Documents are regular files below `documents/` in the documents ref's tree.
`documents/workspace/manifest.json` is the required workspace identity resource.
The hosted app verifies its bytes and schema before opening documents or Beads
storage. Repository membership data may be omitted or empty; in that case a
nonblank `purpose` explains why the workspace exists. Existing schema-v1 manifests
with repository observations remain valid. The purpose is displayed when opening
the workspace. Its
observation timestamp describes a historical observation, not a freshness or
source-publication guarantee. No storage ref, manifest or data is migrated.

Discovery captures full commit IDs. Browsing follows their immutable commit/tree
IDs, so concurrent publication cannot mix document versions. Re-run discovery to
refresh. Selecting another connection, repository or workspace clears displayed
workspace data; errors and **Clear displayed data** do likewise. Workspace reads
use the approved connection/installation through which they were discovered,
without a separate assignment or credential fallback. Every Git read
rechecks the selected installation's repository access and the exact origin grant.

Only the `documents/` and `dolt/` matching-ref prefixes are accepted. Object reads
require full hexadecimal IDs; callers cannot select URLs, headers or methods.
Metadata JSON is capped at 2 MiB while streaming, refs at 5,000, and recursive
trees at 10,000 entries. Truncated trees fail rather than return partial data.
Blob JSON is capped at 24 MiB and decoded blobs at 16 MiB. The hosted reader
checks size and Git blob hash before displaying bytes, previews only regular
UTF-8 text files, and never executes stored HTML or JavaScript.

The Beads inspector reads the Dolt manifest and reports the Git snapshot, storage
root, file count, archive count and aggregate size. It does not interpret NBS,
`.darc` archives or issue rows. Authoritative Dolt querying belongs in the hosted
application; archived JSONL is not used as its Beads data source.

Raw ref discovery can include unprovisioned document namespaces and Dolt-only
recovery snapshots. A namespace with a missing/invalid workspace manifest is
reported as incomplete when opened, rather than treated as a valid workspace or
silently assigned a purpose. Repair uses nugs document/provision operations; the
hosted browser remains read-only and does not migrate existing refs.

Approval applies to scheme + hostname + port, not a path. GitHub Pages project
paths and all branch previews share an origin. Only approve it if you trust all
applications served at that origin. Browser host permissions/match patterns cover
all ports, while broker grants still check the exact origin including its port.
HTTP is allowed only on localhost/127.0.0.1 for development; deployed apps require
HTTPS. The relay accepts top-level same-window messages only. The broker derives
the actual sender origin from browser metadata, not a page-supplied claim.

## Build and publication

`pnpm run pages:build` builds the existing hosted pages, the TanStack SPA at
`app/`, and the mock-data React Storybook at `storybook/` into `hosted-dist/`.
`pnpm run hosted:build` remains available to build the hosted pages and SPA
alone. The Storybook uses relative assets and same-origin Monaco workers under
its branch subdirectory. No runtime application backend is needed.

After CI verification succeeds for a branch push, the `pages` job:

1. Downloads the verified hosted app and Storybook artifact.
2. Replaces `gh-pages/previews/b-<readable-branch>-<hash>/` for that branch.
3. Prunes previews whose source branches no longer exist.
4. Updates a root preview index and `previews.json`.
5. Pushes an ordinary commit to `gh-pages`, uploads the assembled current site
   using `actions/upload-pages-artifact`, and publishes via `actions/deploy-pages`.
6. Adds the exact branch preview and Storybook URLs to the job summary.

Pages must use **GitHub Actions** as its build source. Explicit publication avoids
relying on a `GITHUB_TOKEN` commit to trigger another workflow. No extra App/key
secret is needed. The `github-pages` deployment environment must permit the source
branches to publish; initial setup allows branch previews rather than only master.

PR verification builds/tests but never publishes a duplicate PR copy. Fork PRs
do not get publication tokens. Branch-delete events also clean up once this
workflow exists on the default branch; until then, each successful publication
still prunes deleted branches. Recreated branches and stale builds are checked
before pushing. Publishing is serialized across branches with cancellation
disabled for a running publication. GitHub can replace an older pending job when
multiple jobs queue; rerun a canceled branch workflow if its first preview did
not publish.

### Storage policy

- One current deployment directory per source branch, never per commit.
- Replace the whole branch directory, removing superseded bundled assets.
- Publish only `hosted-dist/`, including the mock-data React Storybook: no
  node_modules, extension ZIPs, source maps, build-machine diagnostics, private
  results, credentials or browser recordings.
- Maximum 24 MiB per build (app + Storybook and their local Monaco editor/workers)
  and 50 MiB for the assembled site. Oversize publication
  fails before pushing, preserving the existing site.
- Hosted build and Pages deployment artifacts expire after one day.
- Git history remains append-only: no force pushes or automatic rewriting.
  Deleted files disappear from the served tree, but Git history still consumes
  cumulative storage. Any eventual history compaction needs a separate decision.

The suggested Preview Pages action defaults to per-commit snapshots. This small
dependency-free publisher plus official Pages actions makes branch replacement,
cleanup, size limits and stale-build handling explicit and testable.

## Current domain setup

The obsolete inherited account-level custom domain has been removed. The project
is served at `https://mickmister.github.io/github-ultimate/` with HTTPS enforced.
Approve `https://mickmister.github.io` in connection settings, including the
browser host permission. All projects and branch previews on this origin share
that approval boundary.

## Verification boundary

Tests cover branch replacement, peer preservation, deleted-branch pruning, stale
builds, size limits, symlink rejection, relative assets, exact origin grants,
connection isolation, Git object bounds, integrity verification and revocation.
Packaged Chrome tests run the production
hosted build under a nested preview URL with actual extension messaging/storage
and simulated GitHub network replies, including workspace discovery, document
reading as inert text, automatic reconnection/selection restoration, incompatible
request/old-relay diagnostics, Beads manifest inspection and revocation of an open
document tab. Browser host access is pre-granted only in
the unattended test manifest; actual users approve it through browser UI. Signed
iOS transport remains a real-device acceptance item.

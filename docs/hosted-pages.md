# Hosted bridge and branch previews

`hosted/` is a small independently deployed web app. It proves the intended split:

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
3. **Connect to extension**, explicitly choose a named connection, then list
   repositories or read `mickmister/workspace-storage`. All requests specify a
   connection; unavailable access never falls back to another one.
4. In extension settings, bind the storage repository + workspace namespace to
   its intended App connection and installation using **Bind workspace**.
   **Discover workspaces**, choose that stored namespace, then **Browse documents**
   and **Read document**. JSON, Markdown, forms and other UTF-8 resources display
   as plain text. **Inspect Beads snapshot** reports its pinned storage metadata;
   Beads issue queries still require an in-browser Dolt engine.
5. Revoke that origin in settings. New reads in the already-open page must fail.

The reference operations are bounded: `discover`, `connections`, `repositories`,
`probe` (default-branch ref), `gitRefs`, `gitCommit`, `gitTree` and `gitBlob`.
`workspaceConnection` resolves the explicitly configured workspace route;
commit/tree/blob requests include and validate the workspace namespace.
No tokens, login/device-flow operations,
arbitrary HTTP or workflow dispatch are exposed. The page keeps results only in
memory, does not save browser storage or install a service worker, and provides
**Clear displayed data**. Generic query-only GraphQL, Dolt issue queries and
separate dispatch grants are future slices.

## Workspace storage contract

Discovery unions `refs/documents/<namespace>` and `refs/dolt/<namespace>` in the
chosen repository. These are candidate storage namespaces, not a new canonical
workspace registry. Dolt-only recovery refs remain visible, and distinct names
are never merged heuristically. The nugs attachment registry is machine-private;
the `nugs-storage` bootstrap branch is not a workspace catalog.

Documents are regular files below `documents/` in the documents ref's tree.
`documents/workspace/manifest.json`, when present, is the existing optional
workspace membership resource and can be read like any other document. Its
observation timestamp describes a historical observation, not a freshness or
source-publication guarantee. No storage ref, manifest or data is migrated.

Discovery captures full commit IDs. Browsing follows their immutable commit/tree
IDs, so concurrent publication cannot mix document versions. Re-run discovery to
refresh. Selecting another connection, repository or workspace clears displayed
workspace data; errors and **Clear displayed data** do likewise. Workspace reads
use their saved App/connection/installation binding, never an inferred default or
credential fallback. Every Git read
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

Approval applies to scheme + hostname + port, not a path. GitHub Pages project
paths and all branch previews share an origin. Only approve it if you trust all
applications served at that origin. Browser host permissions/match patterns cover
all ports, while broker grants still check the exact origin including its port.
HTTP is allowed only on localhost/127.0.0.1 for development; deployed apps require
HTTPS. The relay accepts top-level same-window messages only. The broker derives
the actual sender origin from browser metadata, not a page-supplied claim.

## Build and publication

`npm run hosted:build` writes only HTML, JS/CSS and public build metadata to
`hosted-dist/`. Relative asset URLs work under branch preview paths. No runtime
application backend is needed.

After CI verification succeeds for a branch push, the `pages` job:

1. Downloads the small verified hosted artifact.
2. Replaces `gh-pages/previews/b-<readable-branch>-<hash>/` for that branch.
3. Prunes previews whose source branches no longer exist.
4. Updates a root preview index and `previews.json`.
5. Pushes an ordinary commit to `gh-pages`, uploads the assembled current site
   using `actions/upload-pages-artifact`, and publishes via `actions/deploy-pages`.
6. Adds the exact branch preview URL to the job summary.

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
- Publish only `hosted-dist/`: no Storybook, node_modules, extension ZIPs, source
  maps, private results, credentials or browser recordings.
- Maximum 1 MiB per build and 50 MiB for the assembled site. Oversize publication
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
reading as inert text, Beads manifest inspection and revocation of an open
document tab. Browser host access is pre-granted only in
the unattended test manifest; actual users approve it through browser UI. Signed
iOS transport remains a real-device acceptance item.

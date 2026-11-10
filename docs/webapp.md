# TanStack Start SPA

The new document browser lives at `app/` inside each hosted branch preview.
Existing `index.html` and `settings.html` pages remain available. The new page
links back to both. It uses React and TanStack Start's `spa: { enabled: true }` mode;
there are no server functions, server routes, or application data loaders.

Start builds a server bundle locally solely to generate the static HTML shell.
Only `webapp/dist/client` is copied to `hosted-dist/app` and published to Pages.
No application UI/data is server-rendered. The current SPA has one index route,
so a direct visit or reload works with GitHub Pages directory-index hosting.
Additional pathname routes would need explicit static entry points or a routing
strategy compatible with Pages; no catch-all rewrite is assumed.

## Development

Requires Node 22.12+ and the pnpm version pinned in the root `package.json`.
The root package and `webapp/` share `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run webapp:dev
```

Open `http://127.0.0.1:3100/`. Approve that origin in the extension connection
settings and reload the page to use real data. The extension handles sign-in and
read authorization. The new page supports connection selection, repository and
workspace discovery, verified document listing/reading, and local filtering.
It intentionally does not copy the old settings page's diagnostics or Beads
inspector. It does not persist document contents or navigation selections.

```sh
pnpm run hosted:build       # existing pages + SPA under the branch preview base
pnpm run webapp:check
pnpm run lint:tsx-view-boundary
pnpm test
```

`scripts/build-hosted.mjs` derives the asset base from the source branch and
the same `previewDirectory()` function used for publication. Set
`GITHUB_REF_NAME` and `GITHUB_REPOSITORY` when building for another destination.
`pnpm run webapp:build` builds the standalone SPA at `/` for local static use.

## Interchangeable presentation

```text
Extension bridge + existing verified WorkspaceReader
  -> webapp/src/app-hooks/host.ts (AppHooksV1 adapter)
  -> features/documents/controller.ts (state + semantic commands)
  -> DocumentBrowser.tsx (React subscription/container)
  -> DocumentBrowser.view.tsx (model + actions only)
```

The host exposes narrow readonly DTOs and keeps concrete readers/snapshots
private. The controller owns selection, command preconditions, loading/errors,
and stale-result suppression. The React container accepts an injected
`appHooks` and `presentation`, so fake hosts and alternative layouts can use
the same behavior. Presentations receive neither the host object nor clients.
Search/selection/content remain in the controller when presentation changes.

Candidate layouts should implement `DocumentBrowserPresentation`, keep intrinsic
JSX in `*.view.tsx`, and consume only the model/actions contract. The OpenLint
view-boundary rules run on this source in CI. They do not themselves enforce
all import/API restrictions; keep privileged dependencies in the host adapter.
Compare candidates using the same model fixtures and interaction scenarios.

The browser integration test exercises the built SPA as static files under its
branch base path through a real extension with fixture GitHub responses. It
checks manifest/blob verification, safe text rendering, filtering, narrow
layout, and reload without a web server. Controller tests cover stale requests,
scope changes, invalid commands, failed reads, and disposal.

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

## Document views

Opening a document now mounts a read-only Monaco source editor instead of the
plain-text pane. It supports syntax highlighting, line numbers, folding, word
wrap, find (`Ctrl/Cmd+F`), and light/dark themes. Markdown files also offer a
**Markdown preview** button for headings, lists, tables, task lists, and fenced
code blocks. **Source** returns to the exact verified document text. Switching
views does not issue another document read. HTML scripts, remote embeds, and
unsafe links are removed from the rendered Markdown.

The editor and its JSON/editor workers are lazy-loaded and served from the same
origin as the app, including branch-preview subpaths. Models, editors, and theme
listeners are disposed when a document or view changes. The plain source text
remains available as a fallback if the editor fails to load. These views browse
immutable snapshots; document editing/publishing is not implemented.

The integration takes inspiration from
[hediet/browser-ext-github-monaco](https://github.com/hediet/browser-ext-github-monaco)'s
local loading, editor/model disposal, responsive layout, and theme handling. This
app uses its own React adapter and local Markdown rendering rather than GitHub
textarea replacement or GitHub's Markdown preview endpoint.

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

## Mock-data Storybook

```sh
pnpm run webapp:storybook         # http://127.0.0.1:6010/
pnpm run webapp:storybook:build   # webapp/storybook-static/
pnpm run test:webapp-storybook
pnpm run pages:build              # hosted-dist/ with app/ and storybook/
```

Open **Web app → Document browser → Interactive** to exercise the production
controller with deterministic in-memory `AppHooksV1` capabilities. Discover a
workspace, browse documents, select one, and filter the list. No extension,
GitHub credentials, network API, or browser storage is used. The story runs in
React Strict Mode to exercise the container's mount/disposal lifecycle.

Presentation fixtures open directly in Monaco source, rich Markdown, JSON,
untrusted Markdown, choose-document, loading, read-error, no-connections,
empty-workspace, and long-content states. They use
the same `DocumentBrowserView` and CSS as the deployed app. Fixture interactions
are local demonstration callbacks; use Interactive for the real state machine.

The React Storybook uses its own config in `webapp/.storybook/`, bypassing the
TanStack Start Vite plugin. The existing HTML Storybook remains available via
`pnpm run storybook`. Set `PORT` for a managed preview slot; `STORYBOOK_PREVIEW=1`
disables HMR for proxies without WebSocket support. The server binds to localhost
and allows the managed `*.jamtools.dev` preview hostnames.

The React Storybook is also published at `storybook/` inside each GitHub Pages
branch preview, alongside `app/`. The Pages index and deployment summary link
to it. For example, append
`storybook/?path=/story/web-app-document-browser--reading-document` to a branch
preview URL. It uses static relative assets, including Monaco workers, so no
running development server or extension is needed. `storybook/build.json`
identifies the source branch and commit used for publication.

The browser integration test exercises the built SPA as static files under its
branch base path through a real extension with fixture GitHub responses. It
checks manifest/blob verification, safe text rendering, filtering, narrow
layout, and reload without a web server. Controller tests cover stale requests,
scope changes, invalid commands, failed reads, and disposal.

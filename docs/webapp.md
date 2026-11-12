# TanStack Start SPA

The new document browser lives at `app/` inside each hosted branch preview.
Existing `index.html` and `settings.html` pages remain available. The new page
links back to both. It uses React and TanStack Start's `spa: { enabled: true }` mode;
there are no server functions, server routes, or application data loaders.

Start builds a server bundle locally solely to generate the static HTML shell.
Only `webapp/dist/client` is copied to `hosted-dist/app` and published to Pages.
No application UI/data is server-rendered. TanStack Router uses hash history:
`app/#/documents` browses a workspace and `app/#/documents/<document-id>` opens
a reader page. The Pages deployment prefix stays before the hash; every reload
requests the same `app/index.html`, without a catch-all rewrite.

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
Document routes carry `repository`, `workspace` and an optional `connection`
search field inside the hash. When exactly one approved, signed-in connection is
available to this page, links omit its device-local ID and resolve it on opening.
With multiple approved connections, the link must identify one explicitly;
an explicitly supplied but unavailable ID never falls back to the sole connection.
A copied link or reload reconnects through approved extension
capabilities, discovers that exact workspace, verifies its snapshot and reads
the requested document. An unavailable connection/workspace/document produces an
explicit error rather than silently selecting another one. Connection IDs are
device-specific; a link does not grant access or carry credentials. Document IDs
include the verified blob identity, so a removed or revised resource can become
unavailable in the latest snapshot. Document contents are not persisted.

Browser Back/Forward controls reader navigation. Returning to the same loaded
workspace retains search, expansion, selection and content; reopening that same
loaded document does not read it again. Search and expansion are tab-memory
state, not serialized into links. Standalone embedded document browsers and
presentation stories can still operate without a router.

## Legacy UI migration inventory

The TanStack app currently implements document browsing, rendered/source views
and reusable feedback. The following manual-DOM surfaces still have production
entry points and require separate migration work:

| Surface | Current implementation |
| --- | --- |
| Workspace dashboard, workspace apps and Beads viewer | `hosted/main.ts`, `hosted/components.ts`, `hosted/workspace-apps.ts` |
| Hosted connection/storage settings and diagnostics | `hosted/settings.ts`, `hosted/settings.html` |
| GitHub form, response and workflow UI | `src/content.ts`, `src/ui.ts` |
| Extension sign-in, connection and origin approval settings | `src/connections-page.ts` |
| Extension popup | `src/popup.ts` |

Shared host capabilities and verified readers can support React replacements,
but rendering those surfaces through React remains separate from this routing
change. The dashboard and hosted settings links remain available from the app.

## Document views

The sidebar is an Ark UI tree, built from the verified snapshot's document paths.
Folders sort before files, with natural filename ordering. File labels show the
basename; accessible names and hover titles retain the full path. Folder
expansion and keyboard focus do not fetch document contents. Enter/Space or a
file click opens the document; selecting a document reveals its parent folders.
Arrow keys, Home/End and typeahead follow Ark's tree keyboard behavior.
Search retains and expands matching ancestor folders. Clearing search restores
the previous folder expansion. Expansion resets when the workspace changes.

### Tree appearance

Open **Tree appearance** to choose comfortable/compact rows and an app-default,
blue or teal accent. These preferences are stored in browser local storage;
document contents and navigation are not. If storage is unavailable, the controls
still work for the current tab. Coarse-pointer devices retain comfortable touch
targets even when compact density is chosen.

Embedders and user stylesheets can override these public CSS variables on an
ancestor or individual `.document-tree`; no Ark internals need to be targeted:

```css
.document-sidebar {
  --document-tree-accent: #7252bf;
  --document-tree-selected-bg: #eee8fb;
  --document-tree-indent: 20px;
  --document-tree-row-height: 48px;
  --document-tree-font-size: .9rem;
  --document-tree-radius: 8px;
}
```

Color overrides should provide matching light/dark values and readable contrast.
The built-in palettes follow the system color scheme. The tree is a production
component used by both the hosted app and its Storybook stories; its expansion,
selection and appearance stay in the presentation-independent model/actions.

### Read-only content

Selecting a document opens a full-viewport reading layout, hiding the connection
controls and tree. Markdown documents open in **Markdown preview** by default,
with headings, lists, tables, task lists, and fenced code blocks. Other file
types open in the read-only Monaco source editor. **Source** switches Markdown
to its exact verified text, with syntax highlighting, line numbers, folding,
word wrap, find (`Ctrl/Cmd+F`), and light/dark themes. Switching
views does not issue another document read. HTML scripts, remote embeds, and
unsafe links are removed from the rendered Markdown.

Fenced `mermaid` blocks render as diagrams, including `flowchart TD` and
`flowchart LR`. The renderer is lazy-loaded from the app's own assets, and the
resulting SVG is sanitized. Multiple diagrams can appear in one document;
invalid diagrams retain their readable source with an inline error. **Source**
always shows the original Markdown, including diagram definitions.

**Back to documents** returns to the tree without discarding the selected file,
search, expanded folders or loaded content. **Open fullscreen** reopens that
loaded document without another read. Each new file selection defaults back to
Markdown preview (where applicable) and fullscreen. Escape returns to browsing
in the app; Monaco retains Escape for editor widgets. Keyboard focus moves to
the reader's back button on entry and the selected tree item on return. Loading
and read errors retain the back control; failed reads also offer **Retry document**.
This is an application layout, so it works inside the Storybook iframe and on
phones without requesting browser fullscreen permissions.

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
GitHub credentials or network API is used. Appearance preferences use the same
local browser storage as the app. The story runs in
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

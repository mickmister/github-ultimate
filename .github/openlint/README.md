# UI boundary policy

Adapted from `vibe-kanban-vscode-web/.github/openlint/openlint.yaml` in the
`2286-vd-redesign-2` workspace. Both supporting ast-grep rules are included.
The full TSX boundary command runs both checked-in rules directly through the
pinned `@ast-grep/cli` dependency. It does not require OpenLint. Run
`pnpm install --frozen-lockfile` before using the command. The optional
changed/last-commit and customization-fence commands still require an externally
installed `@mickmister/openlint@0.1.0` executable (`ol`).

## Current coverage

GitHub Ultimate uses imperative TypeScript DOM rendering, not React or TSX:

- `src/content.ts` discovers GitHub records and mounts the PR workspace.
- `src/ui.ts` creates form, response, and snapshot elements, binds events, and
  manages drafts and zen dialogs. `shadow()` installs `src/workspace.css` in
  each Shadow Root, isolating presentation from GitHub's page CSS.
- `popup.html` / `src/popup.ts` and `connections.html` /
  `src/connections-page.ts` provide extension settings surfaces.
- `hosted/main.ts` and `hosted/components.ts` render the hosted dashboard with
  DOM APIs and CSS. `src/hosted-content.ts` bridges the extension to it.
- Storybook uses `@storybook/html-vite`; esbuild bundles the extension.

**The imported rules check JSX syntax only.** They now check the new TanStack
Start app in `webapp/src`, whose presentation lives in `*.view.tsx`. They do not
prove boundaries in the existing imperative `.ts`, HTML, or CSS UI. The webapp
has its own JSX-enabled TypeScript configuration.

## Commands

```sh
pnpm run lint:tsx-view-boundary
pnpm run lint:tsx-view-boundary:changed
pnpm run lint:tsx-view-boundary:last-commit
pnpm run lint:ui-customization-fences
```

The full commands target `src`, `hosted`, and `webapp/src`, avoiding generated bundles and
dependencies. Changed/last-commit commands select files via Git. The new SPA's
views are covered by the full command; the legacy DOM surfaces are not migrated.

`tsx-view-boundary` keeps intrinsic elements such as `<button>` in
`*.view.tsx` (with a story exemption) and hook-like calls/declarations outside
view files. Controllers may render named components and pass data/callbacks.
This is a syntactic convention, not a full guarantee of pure views: fetching,
storage access, and non-hook side effects need separate import/API rules.

`ui-customization-fences` additionally bans JSX `style` attributes and literal
`className` prefixes `tw-` / `css-`. These are optional policy choices, not
general bans on Tailwind or all dynamic styling. They do not inspect `.style`
assignments, imperative `className`, CSS declarations, or all computed values.

The source's `myne-*` presets and local-contracts integration were omitted:
they depend on `scripts/openlint-myne-local.mjs` and Myne-specific trust,
selector, token, and semantic-state contracts absent here.

## Applying the idea to today's UI

For incremental adoption, agree on a renderer/controller contract first:

- Renderers receive typed display data and callbacks; controllers own storage,
  GitHub requests, routing, draft lifecycle, and record validation. Extract one
  surface at a time from the currently mixed rendering/controller functions.
- Keep semantic classes stable and express state with native attributes or
  documented `data-*` attributes. Prefer CSS over presentation-only JS styles;
  retain deliberate runtime geometry such as viewport CSS custom properties.
- Extend the existing color variables into semantic status, spacing, and sizing
  tokens shared where appropriate across extension and hosted surfaces. Shadow
  DOM protects against page CSS but is not itself a theme/customization API.
- Favor container-aware layouts, wrapping, and content-driven sizing. Preserve
  focus, keyboard navigation, and draft state across view updates.

Once module boundaries exist, add TypeScript-aware import restrictions for the
actual `.ts` renderers. Pair those checks with Storybook/Playwright scenarios
for narrow containers, long labels, zoom, dark mode, touch, keyboard/focus,
and loading/error/empty states. Syntax lint cannot establish those behaviors.
The TSX boundary scan now runs in CI for the new SPA. It does not establish
layout quality or boundaries in the legacy DOM surfaces.

# UI boundary policy

## Enforced three-surface pilot

`pnpm run lint:ui` uses the lockfile-pinned `@mickmister/openlint@0.1.0`, explicit
repository policy and three required integrations. It runs the full route/import
graph checker plus both existing ast-grep view-boundary rules. It runs locally,
on push/PR in **UI policy**, in the browser build gate, and before native/EAS/OTA
publication. No runner-global OpenLint is required. The npm package includes native
binaries; its explicit approved postinstall is recorded in pnpm workspace policy.

The initial adopted feature is **Documents**, including its navigation region.
Phone/tablet/desktop views each own markup and have six exported production-component
orientation scenarios. The existing controller is retained behind `Documents.hooks.ts`;
the stable host remains above swaps. Scenario declarations establish coverage, while
Playwright verifies the actual journeys. Geometry classification is provisional:
short side <600 means phone; otherwise long side <=1366 means tablet; larger means
desktop. These are application-space bands, not hardware identification. Height-only
resizes while editing are held to avoid keyboard-induced surface changes. Real-device
keyboard, split-screen and rotation acceptance remains necessary.

`.github/openlint/ui-contracts.json` lists exact adopted and existing migration routes.
A new/unlisted route fails. Legacy Reviews/Kanban remain migration debt, not three-
surface implementations. New presentations in the adopted feature must be registered;
new features require inventory changes in review. The checker resolves TypeScript
aliases/re-exports and verifies route reachability, the host's actual hooks entry,
distinct surface implementations, direct forwarding/cross-surface dependencies,
orientation exports, native UI import ownership and adopted-view text/effect rules.
It does not prove arbitrary helper purity, semantic UX quality, all indirect effects,
or that a disguised shared whole-page component is meaningfully different.

Adopted views use essential purpose-classified `Documents.copy.ts`; raw JSX text,
rendered literal expressions/constants and copy-bearing literal props fail. Structural
attributes and authored/domain data are not application prose. A helper category or
`helperText` prop requires a precise exception. A catalog entry labeled `label` cannot
mechanically prove its wording is necessary—review still removes redundant narration.
Native/imperative DOM/HTML text adapters and broad CSS checks are not implemented by
this pilot; do not claim this gate bans every string throughout the repository.

Exceptions use exact rule/file plus SHA256 of the trimmed diagnostic source line,
owner, reason and ISO `reviewBy`. Unused/expired entries fail; the initial list is empty.
No arbitrary inline disable is supported. This initial fingerprint is deliberately
line-scoped, not AST-identity scoped; changing the diagnostic line requires review.

Run `pnpm run test:ui-policy` for adversarial rule fixtures and geometry cases.
Run `pnpm exec playwright test --config playwright.webapp-storybook.config.ts
tests/webapp-storybook/device-surfaces.spec.ts` for real-controller surface journeys.
`webapp/AGENTS.md` and `mobile/AGENTS.md` describe each-change responsibilities.

The historical notes below describe the older optional presets and legacy boundaries.

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
pnpm run customization:audit
```

The full commands target `src`, `hosted`, and `webapp/src`, avoiding generated bundles and
dependencies. Changed/last-commit commands select files via Git. The new SPA's
views are covered by the full command; the legacy DOM surfaces are not migrated.

`customization:audit` runs the checked-in native-control and inline-style ast-grep
inventories directly over `webapp/src`, without requiring the OpenLint wrapper.
Findings are advisory migration candidates, not CI errors: native controls can
use the shared theme contract, and runtime positioning styles need separate
review. See `docs/ui-customization.md` for the portable JSON and styling contract.

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

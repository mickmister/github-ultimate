# UI changes

Every UI change must consider **phone, tablet and desktop**, each in portrait and
landscape. Device-specific pages and designated high-level regions have three
real implementations; no shared-page alias or tablet-as-desktop shortcut. Keep
semantic URLs and TanStack routes shared. Use the central presentation context,
not per-component viewport/user-agent detection. Native settings are native only;
hosted UI may offer Open native settings, never render its controls.

Stateful features own `Feature.hooks.ts`: state/effects/subscriptions and typed
model/actions. A stable feature host calls the hook above presentation selection.
Views are hook-free. Shared services, leaf controls and content renderers remain
shared. Rotation/resizing must preserve answers, selection, pins and operation
identity. Do not mount all three trees and hide two with CSS.

Register adopted routes/regions in `.github/openlint/ui-contracts.json` and supply
six production-component orientation scenarios. Existing migration records are
exact-route debt, not permission to exempt new pages. Report the scenarios actually
tested; do not claim physical keyboard/OS/WebView acceptance from browser emulation.
For a copy-only edit, assess all consumers and run relevant checks rather than six
redundant physical-device runs.

## Copy

Avoid redundant helper copy. Labels explain actions; do not narrate the adjacent
controls or repeat a setup tutorial. Preserve accessible names, actionable errors,
permission consequences and the distinction between draft, submitted, saved and
workflow delivery. Put technical provenance/setup explanations in contextual help
or Details, not above every document.

Adopted views use feature-owned `Feature.copy.ts` entries classified as action,
label, heading, status, error or permission. A catalog is not a license to add
paragraphs. Authored documents/questions and dynamic domain content remain data
through their existing sanitized renderers. Never shorten user-authored text as a
UI cleanup. There is no blanket ban on text or paragraph elements.

Exceptions in `ui-contracts.json` identify exact rule/file/diagnostic-line SHA256,
reason, owner/Bead and `reviewBy` date. No anonymous inline disables or directory
globs. Remove redundant copy before asking for an exception; explain why an action
label is insufficient and where needed help appears. Unused/expired entries fail.
Do not put native credentials or settings in hosted components to satisfy a layout.

## Checks and delivery

Run `pnpm run lint:ui`, `pnpm run test:ui-policy`, `pnpm run webapp:check`, and
relevant production-component Playwright scenarios. The full graph checker runs
even in changed-file mode. Pilot coverage is Documents; consult exact migration
inventory and `.github/openlint/README.md` rather than claiming all legacy/native
renderers are enforced. Source edits belong in the dedicated task worktree. Commit
intended changes, integrate into this workspace's checkout and push as instructed.

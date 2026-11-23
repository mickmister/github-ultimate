# Vendored Pi Web

- Source: https://github.com/agegr/pi-web
- Commit: `432366bd510c72ce7b678a6cb1220f9cac1ed56c`
- License: MIT, copyright 2026 agegr; see `LICENSE`.
- Import: tracked source from `git archive`, without Git history, dependencies or generated build output. This is **agegr/pi-web**, not jmfederico/pi-web.

The initial integration publishes only `demo/` as a static browser application. Its own committed npm lockfile is authoritative for the demo dependency graph. Do not install or run the root Node agent server for this spike. Keep this package outside the root pnpm workspace while the demo uses its independent upstream lockfile.

## Local changes

- `demo/scripts/prepare-demo-files.mjs` uses an explicit reviewed fixture manifest instead of `git ls-files`, and validates file containment before publication.
- `demo/fixtures/` supplies the public file list and a local welcome document.
- The parent repository's `scripts/build-pi-web.mjs` supplies the complete branch-preview base path, copies the static export, includes provenance/license/build metadata, and enforces the demo payload budget.
- The parent build and browser tests publish and exercise the demo alongside the existing application.

The upstream demo duplicates selected production UI files; its package/dependency versions can differ from the production package. Simulated streaming, file edits, branching and terminal responses are demo behavior. This build does not run Pi inference or persist workspaces.

## Updating

Review a new exact upstream commit and its license/dependency changes. Compare it with the pin above, update the imported tracked source, and reapply only the local changes listed here. Preserve the public fixture allowlist, nested-base configuration and demo-only boundary. Run the parent demo build, upstream demo lint/typecheck, and nested-path browser tests before publishing. Record the new pin and changed local paths here.

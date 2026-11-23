# Pi Web client

Production static frontend for browser-owned Pi chat, with private S3 checkpoints.
`chat/Chat.hooks.ts` owns state, bootstrap and the explicit runtime interface.
`chat/Chat.view.tsx` provides phone, tablet and desktop layouts above the retained
upstream message renderer. `app/` owns the static entry, assets and styles.

There is no simulated API server, repository snapshot, tutorial session seed or
provider-account fixture in the production frontend. Test remote services live in
the parent `tests/pi-web/` fixtures.

The parent build supplies `extension-runtime.js`, Pi 1.5.2 and bundled licenses.
This client retains its independent npm lockfile; use `pnpm run pi-web:install`
from the parent, then `npm --prefix pi-web/client run lint` and `typecheck`.
`pnpm run pi-web:build` supplies the Pages base path and builds the full slice.

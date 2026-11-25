# Browser Pi frontend

The maintained frontend is `client/`. Preserve the upstream MIT license and exact
source provenance in UPSTREAM.md. Removed upstream code remains in Git history.

Use explicit runtime/storage adapters. Never restore a global mock network layer,
canned sessions, fabricated provider usage, simulated tools or sample filesystem.
Unsupported capabilities must remain absent or fail explicitly.

State/effects belong in feature hooks above phone/tablet/desktop view selection;
views are hook-free. Rotation must retain draft, conversation and pending work.
Credentials and connection settings remain in the extension/native host.

Run `npm --prefix pi-web/client run typecheck` and `npm --prefix pi-web/client run lint`,
the parent typecheck and relevant production-browser tests. Build with
`pnpm run pi-web:build` from the parent repository. Never run `next build` while a
Next dev server uses the same checkout; prefer static-export verification here.

Conversation checkpoint and mobile transport changes need meaningful durability,
revocation, size-limit and independent-device tests. Browser emulation does not
establish physical-device or live provider/storage acceptance.

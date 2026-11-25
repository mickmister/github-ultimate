# Browser Pi conversations

`client/` is the production static frontend. It retains the agegr Pi Web message,
Markdown, diagram and code renderers and their dependency closure. The duplicated
upstream Node server, CLI, desktop/file panels and canned backend have been retired.
The imported source remains inspectable at the exact pin in [UPSTREAM.md](UPSTREAM.md).

The parent repository owns the Pi runtime, extension/native brokers and S3 chat
contract in `hosted/pi-chat.ts`. The UI uses the explicit interface in
`hosted/pi-chat-contract.ts`; it does not intercept `fetch` or `EventSource`.
Credentials are configured only in the browser extension or native settings.

From the repository root: `pnpm run pi-web:install`, `pnpm run pi-web:build`,
`pnpm run test:pi-web`. See [setup and persistence](../docs/pi-web-demo.md).

# Pi Web static demo

The branch preview includes agegr's Pi Web UI at `pi-web/`, alongside the existing
application at `app/`. The hosted dashboard links to it as **Pi Web demo**.
See [`pi-web/UPSTREAM.md`](../pi-web/UPSTREAM.md) for the exact source pin,
license, local modifications and update procedure.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm run pi-web:install
pnpm run pi-web:build
pnpm run test:pi-web
```

`pi-web:build` writes `hosted-dist/pi-web/`. `hosted:build` and `pages:build`
also build/stage it automatically. CI installs the demo's frozen npm graph before
building; browser jobs consume the static output and do not need a Pi server.
The upstream Node application is retained as source but is not started or
packaged into the demo deployment.

The build derives the full base path from `GITHUB_REPOSITORY` and
`GITHUB_REF_NAME` (or the current branch locally):

```text
/<repository>/previews/<branch-preview>/pi-web/?session=<session-id>
```

Serve `hosted-dist/pi-web/` at that exact prefix when inspecting a local build.
The browser tests run a real static server at the generated prefix, with no API
fallback. Navigation uses query parameters. Refresh requests the same existing
directory; preserve its trailing slash. `build.json` records the source SHA,
upstream pin and base path, and the published directory includes the upstream
MIT license. The demo has a 12 MiB budget within the 36 MiB branch-preview and
50 MiB total-site limits. These are repository-defined budgets, not GitHub limits.

## Demo behavior

Sessions, model accounts, tool calls and responses are simulated in the browser.
No provider, Pi process, shell, Git checkout or private storage is contacted.
The upstream demo supports in-memory prompts, branches, files and terminal-like
responses. This does not demonstrate real agent execution or durable recovery.

The file explorer receives only `pi-web/demo/fixtures/files.json`. Its welcome
README is a local fixture; other entries are selected public upstream source
files. The generator validates containment and regular-file/size bounds before
copying. It does not enumerate the surrounding Git repository. New public file
entries require an explicit fixture-manifest edit.

Tests cover six viewport orientations in Chromium and WebKit, rotation/draft
retention, query deep links, refresh/back-forward, session switching, simulated
tool replies, local assets, license and fixture boundaries. These are browser
emulation checks, not physical-device acceptance.

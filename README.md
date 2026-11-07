# GitHub Ultimate

**Your pull request, a human–agent workspace.** A browser extension that turns ordinary GitHub comments into decision forms, saved workflow views and bead progress. Chrome is installable today; Safari iOS compatibility code and build resources are available for later Xcode packaging. GitHub remains the persistent workspace; no application backend or API token is needed for this release.

## Install

1. Download the ZIP from [GitHub Releases](https://github.com/mickmister/github-ultimate/releases/latest).
2. Extract it to a persistent folder.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Choose **Load unpacked**, then the extracted folder containing `manifest.json`.
5. Open a GitHub PR or issue conversation. Use **PR workspace** at the bottom right.

For updates, replace the extracted files and click **Reload** on the extension card. This is a developer-mode ZIP, not a Web Store-signed CRX.

**Safari on iPhone/iPad:** `npm run build:safari` produces `dist-safari/` for later Xcode conversion/signing. See [Safari iOS preparation and verification](docs/safari-ios.md). These resources are not an installable iOS app.

## What works

- **Forms in comments:** BeadsForm-style textareas and checkbox choices, exclusive groups, recommendations, assumptions, pros/cons, contextual notes and Next Instruction.
- **Focused questions:** multi-question forms have a question index, Previous/Next navigation and a final review. Browse or skip questions freely; unanswered requested questions are listed and recorded. Global notes stay outside the step count.
- **Zen view:** open the same form in a centered overlay without losing answers or position. Escape closes it and restores focus. Offscreen pending forms have a sticky **Go to form** control, with a selector when several need input; zen never opens automatically.
- **Submitted answers:** matching posted responses collapse the form into a read-only summary. Expand the answer history or choose **Submit another response** for a separate submission with a new ID.
- **Explicit intent:** “Continue discussion” generates `/github-ultimate discuss`; “Approved for next steps” generates `/github-ultimate approve`. Both include readable structured answers, source-comment SHA-256 and task/session references.
- **Native submission:** review the generated comment, copy it or insert it into GitHub's existing editor without replacing your draft, then click GitHub's Comment button. Nothing auto-submits.
- **Draft recovery:** form values, notes and wizard position survive reloads in extension-local browser storage. Pending edits flush when a page is hidden or leaves. Changes to the source record start a separate revision-bound draft.
- **PR workspace:** forms, saved responses, attention counts, latest task state, complete loaded run history, bead progress and private Tailscale dashboard links.
- **SPA-safe UI:** initial load, navigation, edited comments, lazy-loaded records, light/dark themes, native fallback and settings.

## Try it now

Paste these complete comment bodies into any GitHub PR or issue conversation:

1. [Decision form — pretty JSON](docs/examples/form-comment.md)
2. [Follow-up question — YAML frontmatter](docs/examples/yaml-comment.md)
3. [Saved workflow and beads — JSON](docs/examples/workflow-comment.md)

Comment records can be authored manually or published with the CLI below. The extension can render and compose responses before workflow handlers exist. After posting a generated response and loading that comment, the form is marked submitted and collapsed. Posted submissions are immutable in the extension; **Submit another response** starts a separate answer rather than editing history. Previewing, copying or inserting a comment does not mark the form submitted.

The CLI publishes readable questions alongside the structured form, and generated responses include a readable answer summary. Both use native GitHub disclosure sections so comments remain useful without the extension. Contextual notes use compact comment icons with accessible labels, and keyboard input within the extension stays isolated from GitHub shortcuts.

Only comments loaded in the GitHub page are included. Use GitHub's **Load more** controls to include older records. **Rescan** reindexes the loaded DOM; it does not contact workflow APIs. Snapshot timestamps show freshness rather than pretending a stopped runner is live. The extension also works on issue conversations for easy testing.

## Authoring protocol

### Publish with one command

```sh
./bin/github-ultimate-form path/to/form.json
# or: npm run form -- --file path/to/form.yaml
```

The publisher validates the DSL, uses `gh` to find the current repository/PR,
and posts the form comment. File/stdin input, preview/dry-run, JSON output,
retry keys and automatic GitHub Actions context are supported. A reusable
form-posting composite action uses the same operation. See [form CLI and
Actions usage](docs/form-cli.md).

Use a fenced `github-task` block for a standard form, `github-workflow` for a saved run, or `github-response` for answers. JSON is recommended for question arrays: **pretty-print it rather than minifying it**. YAML documents, including frontmatter followed by Markdown instructions, are supported for input definitions. A normal `json`/`yaml` fence is also discovered when its data explicitly declares the supported record type.

See [the versioned protocol](docs/protocol.md) for supported fields, bounds and dispatch semantics. Raw source remains available with **Show / hide original record**. Unknown fields/versions are rejected with an error while preserving the original code.

Records are untrusted presentation data. A saved response/run does not prove who executed it. Future trusted handlers must verify requester permission, source revision, allowed action and session context independently. There are currently **no agent-execution handlers**. Ordinary comments do not trigger anything. Future workflow runs will use Gas City → OpenCode, an external LiteLLM URL from CI secrets, durable resumable sessions and a private Tailscale dashboard.

## Privacy and permissions

The extension has only the `storage` permission and injects on `https://github.com/*` so navigation into a PR works. It does not use API tokens, analytics, background network polling or external executable code. Settings and form drafts stay in your browser profile and are not encrypted; use the toolbar popup to disable persistence or clear saved drafts. Do not enter credentials into public forms. Drafts are scoped by repository, thread, comment, form and source revision, not by signed-in GitHub account; users sharing a browser profile share its drafts. Generated response IDs and canonical comments are stored only when **you** submit through GitHub.

Dashboard links accept private `https://node.tailnet.ts.net/` hosts without query strings/credentials; run links must point into the current repository's Actions runs. The extension doesn't create tunnels or make private links public. Native GitHub content stays available if you disable the extension.

## Development and verification

### Styling playground

```sh
npm ci
npm run playground
```

Open `http://localhost:5173`. The Vite playground uses the extension's **actual**
parser, Shadow DOM renderer and `src/workspace.css`, with no Chrome installation
or GitHub login required. Choose a story, edit pretty JSON or YAML frontmatter,
then click **Render source**. Theme/width controls and live CSS overrides let you
iterate without clearing form answers. Try the local GitHub comment editor to
inspect generated slash commands without posting anything.

Examples cover decisions, a multi-question wizard, collapsed submitted forms,
YAML follow-ups, saved workflow/bead snapshots, responses, superseded forms,
long content and validation failures. Source/style
edits are saved in your browser. **Export CSS/source** produces files to use in
a fork or contribution; preview edits do not modify repository files. **Copy
share link** includes your current source/styles in its URL fragment, so only
share non-sensitive example data. Add exported rules to `src/workspace.css` when
you want the extension build to include them.

`npm run playground:build` creates a standalone static `playground-dist/` site;
`npm run test:playground` tests it in a normal browser. In a managed preview,
the server uses the assigned `PORT` and supports the `*.jamtools.dev` host.

### Extension checks

Requires Node 22 and Chrome/Chromium 120+.

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run package
```

Load `dist/` unpacked for development. `release/` contains the ZIP and checksum. Packaging is deterministic with a fixed archive timestamp and a locked dependency graph. Each extension ZIP contains MIT project licensing and complete runtime dependency licenses.

Playwright loads the **actual built extension** in an isolated Chromium profile against controlled GitHub-shaped pages, covering native draft composition/no auto-submit, intent and session serialization, drafts/notes/wizard position, immutable submissions and revision matching, zen focus/Escape, multiple pending forms, capture-phase keyboard isolation, progress/dashboard links, SPA cleanup and malicious records. This is complemented by a public-GitHub DOM smoke check during release preparation; authenticated native-editor behavior still merits checking in your own account when GitHub changes its DOM.

CI runs type checks, protocol/publisher tests, packaged Chrome tests, mobile WebKit/Chromium checks and creates the Chrome ZIP. It also retains unsigned Safari resources for later Xcode packaging. Every successful branch-push run publishes one **prerelease** with the tested Chrome ZIP and SHA-256 checksum. Tags use `continuous-<branch-slug>-<workflow-run-id>`: separate pushes get separate releases, while rerunning a workflow repairs the same release. Release notes identify the branch, exact commit, workflow run and installation steps. Prereleases do not replace the latest stable release; their manifest version remains the package version.

Pull-request and manual verification runs do not publish prereleases. Failed verification does not publish a release. Publishing starts as a draft and becomes public after both assets upload successfully. Pushing a matching `v<package version>` tag publishes the verified artifact as a stable GitHub Release. CI uses its own repository-scoped release token; no deployment secret is required.

## Scope and research

The first release focuses on the Chrome PR view. Safari iOS compatibility/mobile code is implemented; Xcode packaging and signed real-device acceptance remain pending. Gas City execution handlers, model/session infrastructure, account-wide workflow monitoring, Notifications integration and Monaco remain planned follow-on work.

- [Initial research](docs/intake-analysis.md) — historical intake; later decisions are tracked in beads.
- [Original standalone decision form](docs/intake-form.json)
- [Third-party provenance](THIRD_PARTY_NOTICES.md)

Workspace beads: epic `task-h1i`; Chrome milestone `task-h1i.28`; CI/release delivery `task-h1i.29`. Run `bd` from the workspace root, not this repository subdirectory.

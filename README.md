# GitHub Ultimate

**Your pull request, a human–agent workspace.** A Chrome extension that turns ordinary GitHub comments into decision forms, saved workflow views and bead progress. GitHub remains the persistent workspace; no application backend or API token is needed for this release.

## Install

1. Download the ZIP from [GitHub Releases](https://github.com/mickmister/github-ultimate/releases/latest).
2. Extract it to a persistent folder.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Choose **Load unpacked**, then the extracted folder containing `manifest.json`.
5. Open a GitHub PR or issue conversation. Use **PR workspace** at the bottom right.

For updates, replace the extracted files and click **Reload** on the extension card. This is a developer-mode ZIP, not a Web Store-signed CRX.

## What works

- **Forms in comments:** BeadsForm-style textareas and checkbox choices, exclusive groups, recommendations, assumptions, pros/cons, contextual notes and Next Instruction.
- **Explicit intent:** “Continue discussion” generates `/github-ultimate discuss`; “Approved for next steps” generates `/github-ultimate approve`. Both include readable structured answers, source-comment SHA-256 and task/session references.
- **Native submission:** review the generated comment, copy it or insert it into GitHub's existing editor without replacing your draft, then click GitHub's Comment button. Nothing auto-submits.
- **Draft recovery:** form values and notes survive reloads in local Chrome storage. Changes to the source record start a separate revision-bound draft.
- **PR workspace:** forms, saved responses, attention counts, latest task state, complete loaded run history, bead progress and private Tailscale dashboard links.
- **SPA-safe UI:** initial load, navigation, edited comments, lazy-loaded records, light/dark themes, native fallback and settings.

## Try it now

Paste these complete comment bodies into any GitHub PR or issue conversation:

1. [Decision form — pretty JSON](docs/examples/form-comment.md)
2. [Follow-up question — YAML frontmatter](docs/examples/yaml-comment.md)
3. [Saved workflow and beads — JSON](docs/examples/workflow-comment.md)

Comment records are manually authored for now. The extension can render and compose responses before workflow handlers exist. After posting a generated response and loading that comment, the form is marked answered in the workspace. You may still edit the form and send another explicit response.

Only comments loaded in the GitHub page are included. Use GitHub's **Load more** controls to include older records. **Rescan** reindexes the loaded DOM; it does not contact workflow APIs. Snapshot timestamps show freshness rather than pretending a stopped runner is live. The extension also works on issue conversations for easy testing.

## Authoring protocol

Use a fenced `github-task` block for a standard form, `github-workflow` for a saved run, or `github-response` for answers. JSON is recommended for question arrays: **pretty-print it rather than minifying it**. YAML documents, including frontmatter followed by Markdown instructions, are supported for input definitions. A normal `json`/`yaml` fence is also discovered when its data explicitly declares the supported record type.

See [the versioned protocol](docs/protocol.md) for supported fields, bounds and dispatch semantics. Raw source remains available with **Show / hide original record**. Unknown fields/versions are rejected with an error while preserving the original code.

Records are untrusted presentation data. A saved response/run does not prove who executed it. Future trusted handlers must verify requester permission, source revision, allowed action and session context independently. There are currently **no agent-execution handlers**. Ordinary comments do not trigger anything. Future workflow runs will use Gas City → OpenCode, an external LiteLLM URL from CI secrets, durable resumable sessions and a private Tailscale dashboard.

## Privacy and permissions

The extension has only the `storage` permission and injects on `https://github.com/*` so navigation into a PR works. It does not use API tokens, analytics, background network polling or external executable code. Settings and form drafts stay in your Chrome profile and are not encrypted; use the toolbar popup to disable persistence or clear saved drafts. Do not enter credentials into public forms. Drafts are scoped by repository, thread, comment, form and source revision, not by signed-in GitHub account; users sharing a Chrome profile share its drafts. Generated response IDs and canonical comments are stored only when **you** submit through GitHub.

Dashboard links accept private `https://node.tailnet.ts.net/` hosts without query strings/credentials; run links must point into the current repository's Actions runs. The extension doesn't create tunnels or make private links public. Native GitHub content stays available if you disable the extension.

## Development and verification

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

Playwright loads the **actual built extension** in an isolated Chromium profile against controlled GitHub-shaped pages, covering native draft composition/no auto-submit, intent and session serialization, drafts/notes, progress/dashboard links, SPA cleanup and malicious records. This is complemented by a public-GitHub DOM smoke check during release preparation; authenticated native-editor behavior still merits checking in your own account when GitHub changes its DOM.

CI runs type checks, protocol tests, packaged browser tests and creates the ZIP. Pushing a matching `v<package version>` tag publishes that CI artifact as a GitHub Release asset **only after verification succeeds**. CI uses its own repository-scoped release token; no deployment secret is required.

## Scope and research

The first release focuses on the Chrome PR view. Gas City execution handlers, model/session infrastructure, account-wide workflow monitoring, Notifications integration, Monaco and Safari iOS remain planned follow-on work.

- [Initial research](docs/intake-analysis.md) — historical intake; later decisions are tracked in beads.
- [Original standalone decision form](docs/intake-form.json)
- [Third-party provenance](THIRD_PARTY_NOTICES.md)

Workspace beads: epic `task-h1i`; Chrome milestone `task-h1i.28`; CI/release delivery `task-h1i.29`. Run `bd` from the workspace root, not this repository subdirectory.

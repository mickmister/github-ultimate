## Chrome PR workspace

Download the Chrome extension ZIP linked above, extract it, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.

The patch release accepts actual dotted bead IDs (for example `task-h1i.29`) and provider session references while keeping question/answer-field identifiers strict.

### Included

- Inline BeadsForm-style questionnaires in GitHub PR and issue comments: checkbox choices/groups, textareas, descriptions, recommendations, tradeoffs, per-choice/per-question notes and Next Instruction.
- Readable JSON and YAML frontmatter definitions, bounded strict validation, safe Markdown and visible unsupported-record errors.
- Separate discussion-only and approved-next-steps commands; revision-bound source IDs and resumable-session references.
- Comment preview, copy fallback, native GitHub draft insertion without automatic submission, and local form draft recovery.
- PR workspace panel with forms/responses, task attention states, saved run history, bead progress and private Tailscale dashboard links.
- Dark/light themes, navigation-aware mounting, cleanup, raw-record access and extension settings.

### Try it

Copy the example comment bodies in `docs/examples/` into a GitHub PR or issue. Open **PR workspace** in the lower-right corner. Fill a form, review the generated command, then place it in the native editor and click GitHub's **Comment** button yourself.

The ZIP is built and tested in GitHub Actions. Its SHA-256 checksum is attached alongside it. This is a developer-mode release, not a Chrome Web Store-signed CRX.

### Deliberate boundaries

This is the Chrome presentation/interaction release. Gas City/OpenCode workflow handlers, LiteLLM execution, durable session restoration, OAuth, account-wide dashboards, Monaco and Safari packaging follow separately. No ordinary comment launches an agent; this extension itself does not execute commands. Workflow snapshots are comment-provided data, not verified live status. Only comments loaded by GitHub are indexed. Private dashboard links require access to your Tailscale tailnet.

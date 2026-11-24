# Upstream provenance and local adaptation

- Source: https://github.com/agegr/pi-web
- Imported revision: `432366bd510c72ce7b678a6cb1220f9cac1ed56c`
- License: MIT, copyright 2026 agegr; retained in `LICENSE`.
- Original import is preserved in this repository's Git history at
  `74df9c6b45cad8b0489cdbd3b5b10a5df1d12685`.

The first evaluation built the upstream static demo with ten allowlisted public
files. The production conversion supersedes that demo: `demo/` became `client/`,
with one browser frontend, direct Pi/S3 adapters and a real empty state. The global
mock API/EventSource installer, tutorial scripts, fake models/usage/files/terminal,
snapshot generator and generated public demo files were removed.

The production frontend retains the adapted message/Markdown/diagram/code renderers,
their static assets and runtime/type dependency closure. TypeScript reachability
and an esbuild entry dependency graph were inspected before pruning. The unused
duplicated root frontend, Node API/session manager, CLI, container packaging and
upstream-only tests/workflows were retired. Their exact historical source remains
at the pins above. This is a maintained selective fork, not a pristine vendor tree.

The original `SessionSidebar.tsx` was not retained wholesale: it couples session
rows to the Node session API, filesystem explorer, project/worktree operations and
terminal controls. `client/chat/SessionSidebar.view.tsx` adapts its compact title,
time/message-count and selected-row presentation to canonical S3 conversations,
with search and actions owned by the shared feature hook. Original source remains
recoverable at the import pin for further selective reuse.

The parent builds Pi 1.5.2 separately and keeps provider/S3 credentials in the
extension or Alohak native host. UI sessions use the versioned `pi-web-chat-1`
profile, independently of the older workspace-agent checkpoint schema. Existing
workspace-agent checkpoints remain supported by their original Agent screen.

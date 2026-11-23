# Third-party notices

The `pi-web/` application source is vendored from
[`agegr/pi-web`](https://github.com/agegr/pi-web), commit
`432366bd510c72ce7b678a6cb1220f9cac1ed56c` (MIT, copyright 2026 agegr).
The static demo retains that license at `pi-web/PI_WEB_LICENSE.txt` in the
published preview. See `pi-web/UPSTREAM.md` for provenance and local changes.

Runtime dependencies bundled in the extension:

| Package | License |
| --- | --- |
| DOMPurify | Apache-2.0 OR MPL-2.0 |
| marked | MIT |
| yaml | ISC |
| zod | MIT |
| aws4fetch | MIT |
| fast-xml-parser and its bundled runtime dependencies | MIT |

The build includes the complete installed dependency license texts in
`THIRD_PARTY_LICENSES.txt` in the extension ZIP. Exact versions are pinned by
`pnpm-lock.yaml`. Bundled legal comments are retained.

The hosted TanStack application's Kanban view additionally bundles
`@svar-ui/react-kanban` 2.6.0 (MIT) and its runtime dependencies. SVAR's board is
used for read-only presentation; its paid PRO edition is not included.

The form protocol and interaction design were reviewed against
`vibe-dashboard/vibe-dashboard` / the local `vibe-kanban-vscode-web` checkout,
branch `vk/8299-beads-web-show-m`, revision
`286088bd7` (Apache-2.0). The browser UI is independently implemented using the
textarea/checkbox subset: notes, recommendations, informational assumptions,
choice groups, Next Instruction, superseded forms and explicit submit intent.
No dashboard server/runtime or source code from the unlicensed Commit Lens or
GitHub Monaco extensions is included.

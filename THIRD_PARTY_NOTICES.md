# Third-party notices

Runtime dependencies bundled in the extension:

| Package | License |
| --- | --- |
| DOMPurify | Apache-2.0 OR MPL-2.0 |
| marked | MIT |
| yaml | ISC |
| zod | MIT |

The build includes the complete installed dependency license texts in
`THIRD_PARTY_LICENSES.txt` in the extension ZIP. Exact versions are pinned by
`pnpm-lock.yaml`. Bundled legal comments are retained.

The form protocol and interaction design were reviewed against
`vibe-dashboard/vibe-dashboard` / the local `vibe-kanban-vscode-web` checkout,
branch `vk/8299-beads-web-show-m`, revision
`286088bd7` (Apache-2.0). The browser UI is independently implemented using the
textarea/checkbox subset: notes, recommendations, informational assumptions,
choice groups, Next Instruction, superseded forms and explicit submit intent.
No dashboard server/runtime or source code from the unlicensed Commit Lens or
GitHub Monaco extensions is included.

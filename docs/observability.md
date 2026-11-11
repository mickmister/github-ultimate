# Shared CI observability

The canonical CargoWall + Thoth action lives in
[`gh-agentic-workflows`](https://github.com/mickmister/gh-agentic-workflows/blob/vk/46e5-vd-multi-instanc/.github/actions/observability/README.md).
This repository consumes that action at a pinned source commit in
`.github/workflows/ci.yml` (build, browser matrix and Pages jobs) and
`.github/workflows/observability-smoke.yml` (cross-repository light/full checks).

The CI manual-run input `observability-profile` selects `light` or `full`;
ordinary push runs default to `light`. Inputs, permissions, lifecycle and
same-repository usage are documented with the shared action. Keep references
in both workflows aligned when promoting a new shared-action version.

Call the action using remote `owner/repo/path@ref` syntax so its nested
pre-hooks start CargoWall before Thoth. Each job retains a final raw CargoWall
audit snapshot; Thoth exports its signal artifacts automatically at cleanup.

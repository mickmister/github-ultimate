# Native workspace workflow

`.github/workflows/nugs.yml` calls the reusable workflow in
`mickmister/gh-agentic-workflows` on branch `vk/46e5-vd-multi-instanc`. It has no
required workflow inputs or changing checkpoint arguments.
The separate `.github/workflows/agentic.yml` is the thin default-branch
issue-comment/manual entrypoint; its routing stays in the shared workflow repo.

## One-time setup

In this repository's Actions configuration:

1. Add Actions secrets `AGENT_APP_ID`, `AGENT_APP_PRIVATE_KEY` (the complete PEM)
   and `NUGS_STORAGE_URL`. The App ID is also a secret, not a variable, in this
   setup. Reuse the existing `gh-agentic-workflows-mickmister` App.
2. Set repository variable `NUGS_WORKSPACE_SEED` to the endpoint-free `.handoff`
   object returned by `nugs beads sync` in the authorized local workspace.
   Configure the secrets before setting this opt-in variable.

The workflow skips its job until the seed variable is configured. The existing
workspace identity and native collection are preserved; this does not initialize
a repository-specific Beads collection.

The shared workflow generates two short-lived installation tokens from the one
App: a source token limited to the three source repositories and a Contents-write
storage token limited to workspace storage. No PAT or permanent installation-token
secret is needed. Only storage authentication reaches the nugs worker. Both token
scopes are checked through GitHub and tokens are revoked at job completion.
The current proof job is bounded to 20 minutes; longer future agent jobs must
refresh credentials before their approximately one-hour expiry.

## Running

Run **Native workspace persistence** through Actions, or push an update to its
workflow file. The seed can remain unchanged: the runner restores its historical
checkpoint, synchronizes current native history, and generates new checkpoint
descriptors internally. Local replicas may keep editing during the run.
Both the reusable workflow reference and implementation checkout follow the shared
workspace branch during iteration. Fixes there are available to the next call
without editing source-repository commit pins.

The current reusable workflow runs a bounded synthetic persistence worker. It
verifies native checkpoints, version-checked document updates, final sync and
independent recovery. Proof artifacts are scoped to this caller repository.
Component receipts are attached to the Actions run and archived through nugs.

PR-comment agent execution is the next layer. This plumbing workflow does not
interpret comment instructions, execute an agent, or modify repository source.
Once the scoped entrypoint PR is merged into the source default branch, central
routing accepts manual dispatch or an exact `/agentic plumbing` comment from an
author with repository write access. Other comments/coding-agent commands do no
work until their separate execution stage is implemented and authorized.

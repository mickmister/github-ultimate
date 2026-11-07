# Native workspace workflow

`.github/workflows/nugs.yml` calls the reusable workflow in
`mickmister/gh-agentic-workflows` at a reviewed immutable revision. It has no
required workflow inputs or changing checkpoint arguments.

## One-time setup

In this repository's Actions configuration:

1. Add secrets `NUGS_STORAGE_URL` and `NUGS_STORAGE_TOKEN` for the selected workspace
   storage repository. The token needs Contents read/write on that data repository;
   it is not a token for pushing source changes.
2. Set repository variable `NUGS_WORKSPACE_SEED` to the endpoint-free `.handoff`
   object returned by `nugs beads sync` in the authorized local workspace.
   Configure the secrets before setting this opt-in variable.

The workflow skips its job until the seed variable is configured. The existing
workspace identity and native collection are preserved; this does not initialize
a repository-specific Beads collection.

## Running

Run **Native workspace persistence** through Actions, or push an update to its
workflow file. The seed can remain unchanged: the runner restores its historical
checkpoint, synchronizes current native history, and generates new checkpoint
descriptors internally. Local replicas may keep editing during the run.

The current reusable workflow runs a bounded synthetic persistence worker. It
verifies native checkpoints, version-checked document updates, final sync and
independent recovery. Proof artifacts are scoped to this caller repository.
Component receipts are attached to the Actions run and archived through nugs.

PR-comment agent execution is the next layer. This plumbing workflow does not
interpret comment instructions, execute an agent, or modify repository source.

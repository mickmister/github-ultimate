# Publish forms with GitHub CLI

Give the publisher **one form DSL**. It validates the same schema as the Chrome
extension, resolves the current repository and open PR using `gh`, and posts a
pretty-printed `github-task` comment. You do not have to calculate repository,
PR, Markdown fences or a comment URL yourself.

Requires Node 22, `npm ci`, GitHub CLI, and `gh auth login` (or `GH_TOKEN` /
`GITHUB_TOKEN`). Only github.com PR conversation comments are supported.

```sh
# Run from a checkout on the branch whose PR should receive the form:
./bin/github-ultimate-form path/to/form.json
npm run form -- --file path/to/form.yaml

# Or send DSL over stdin:
./bin/github-ultimate-form < path/to/form.json

# Existing complete example comments with one form fence work too:
./bin/github-ultimate-form docs/examples/form-comment.md --dry-run

# Validate/format without authentication, context lookup or posting:
./bin/github-ultimate-form --file path/to/form.json --print

# Override context only when needed:
./bin/github-ultimate-form --file path/to/form.json --repo owner/repo --pr 42 --json
```

`npm link` optionally exposes the `github-ultimate-form` command globally from
this checkout. `npm run form -- ...` is always available without linking.

## Input and results

Accepts standard form DSL as pretty JSON, YAML/frontmatter, or a complete example
with exactly one `github-task`/JSON/YAML fence. Workflow snapshots, response
records, multiple forms and invalid schemas are rejected. The publisher does not
invent questions or modify submit intent. It posts normalized, readable JSON
including schema defaults and any Markdown instructions from frontmatter.

`--dry-run` resolves the PR but performs no write. `--print` needs no GitHub
access. `--json` returns the repository, PR number/URL, form ID, exact posted body,
comment ID/URL and whether an existing submission was reused. Errors exit nonzero.
Tokens are read by `gh`, never inserted into the form or printed by this CLI.
Neither publishing a form nor this action executes slash commands or agents.

## Automatic context

Locally, `gh repo view` and `gh pr view` resolve the current checkout's open PR.
In Actions, the repository comes from `GITHUB_REPOSITORY`; PR numbers come from:

- `pull_request` / `pull_request_target` event payloads;
- `issue_comment` when the issue is a PR, not a normal issue;
- a `workflow_run` containing exactly one PR;
- a `refs/pull/<number>/merge` or `/head` ref;
- a dispatch/push branch with exactly one open PR.

Ambiguous context, ordinary issue events, closed PRs, mismatched repository/PR
URLs and multiple workflow-run PRs fail with an actionable error. An explicit
`--repo`/`--pr` can target a PR intentionally. This avoids accidentally publishing
to an unrelated default-branch PR from a detached Actions checkout.

## Retry behavior

`--submission-id <stable-id>` makes sequential retries reuse the exact same
comment. Actions automatically uses `run-<GITHUB_RUN_ID>-<form.id>` so rerunning
the same job does not post the same form again. A new workflow run is a new
publication. If the form content changes under the same key, publication fails
rather than silently editing a source form that may already have answers. Give a
revised form a new ID/key. Local invocations create a new comment unless a stable
submission ID is provided.

Retry matching uses a hidden comment marker, not an execution-authority claim.
GitHub has no atomic create-comment idempotency key: serialize publishers that
share a key (for example with workflow concurrency). If posting succeeds but its
response is lost, retry with the same key. Do not run concurrent publishers with
the same run/form ID. Source revisions and requester authorization still belong
to future execution handlers.

## Use the CLI directly in GitHub Actions

After checking out this extension and running `npm ci`:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write

steps:
  # Generate or download form.json using your trusted workflow steps first.
  - name: Publish a decision form
    env:
      GH_TOKEN: ${{ github.token }}
    run: ./bin/github-ultimate-form --file form.json --json --github-output
```

`--github-output` appends `repository`, `pr-number`, `pr-url`, `form-id`,
`comment-id`, `comment-url` and `reused` to the runner's `GITHUB_OUTPUT` file.
Standard `ubuntu-latest` runners provide `gh`; other runners must install it.
Ensure the token can comment on the target PR. Read-only fork PR tokens may be
unable to post; use an appropriately configured trusted posting job, rather
than changing the extension or exposing secrets to PR code.

## Reusable composite action

This repo also includes `.github/actions/post-form/action.yml`, which sets up
Node 22, installs the publisher runtime dependencies and calls the same CLI:

```yaml
- name: Publish form
  id: form
  uses: mickmister/github-ultimate/.github/actions/post-form@<reviewed-commit-sha>
  with:
    form-file: path/to/generated-form.json
    # pr-number: 42      # optional when automatic event resolution is unavailable
    # repository: owner/repo
    # submission-id: stable-operation-id
    # token: ${{ secrets.POSTING_TOKEN }}  # default is github.token
- run: echo "Form comment is $FORM_COMMENT_URL"
  env:
    FORM_COMMENT_URL: ${{ steps.form.outputs.comment-url }}
```

The form path is relative to the caller's working directory. A local action can
also use `./.github/actions/post-form`; its install step runs `npm ci --omit=dev`
in the extension checkout, so place it in a dedicated posting job after any
build/tests that need development dependencies. The action is ready to be used
once its source is pushed; no new workflow trigger or agent handler is enabled
just by adding it.

# Read-only Pi Chat workspace context

Chat exposes these capabilities inside its existing bounded QuickJS `codemode`
tool. Pi still owns the model/tool loop and durable assistant/result boundaries.

```js
text(await tools.workspace_sources({}));
text(await tools.workspace_files({
  operation: 'read', source: 'documents', path: 'projects/example/design.md',
  startLine: 1, lineCount: 100,
}));
text(await tools.workspace_files({
  operation: 'search', source: 'github:app', path: 'src', query: 'createSession',
  offset: 0, limit: 20,
}));
```

Discover source IDs rather than assuming a member called `app`. `connectionId`
can resolve ambiguous GitHub authorization; without it, each repository must have
one uniquely approved connection. An invocation cannot change its connection
selection. Separate uniquely authorized connections can serve storage and sources.

## Sources and revisions

- `documents`: verified regular files under the selected nugs workspace's
  `documents/` tree. One exact document snapshot and manifest are opened per
  explicit invocation. Reads return blob version, snapshot, canonical workspace
  identity and a revision-pinned document viewer URL.
- `github:<manifest-member-path>`: associated repository source. Repository
  identity comes from a unique GitHub origin remote (or a unique GitHub remote
  when no origin exists), never a machine-local path. Branches resolve to published
  remote commits when context is first used in the invocation; detached members
  retain their explicit commit. All members of the same repository must use one
  consistent revision. Unavailable, conflicting, ambiguous and unpublished
  revisions produce source notices. The manifest's observed local commit and
  publication/dirty flags remain separate from the actual read commit. Reads use
  verified lazy tree/blob operations and return exact GitHub commit URLs.
- `s3:<configured-id>`: explicitly bound workspace object files. No S3 source is
  inferred from the chat storage connection, a connection name or a broad bucket
  grant. Configure these using the document described below.

Source content is data, not permission to bypass the selected workspace or host
grants. The agent receives no credentials, arbitrary fetch or shell capability.
Every capability rechecks workspace scope and original host authorization,
including before returning cached content. Native Git reads reuse the shared
actor/installation checks and query-only GraphQL validator. The native host must
include `agentGraphql`, `agentTree` and `agentBlob` support; update older hosts.

## Optional S3 bindings

Publish `workspace/context-sources.json` in the selected nugs document namespace:

```json
{
  "schema_version": 1,
  "sources": [{
    "id": "notes",
    "kind": "s3",
    "endpoint": "https://s3.example.com/",
    "bucket": "workspace-files",
    "prefix": "workspaces/example/notes/"
  }]
}
```

This config records a remote association, not credentials or a device-local
connection UUID. Exactly one locally approved, read-enabled connection must match
the endpoint and bucket, with a grant containing the entire configured prefix.
Prefixes must be nonempty and end in `/`; returned keys cannot escape them.
Missing config leaves S3 unavailable with an explicit notice. Invalid S3 config
does not disable otherwise valid document/GitHub sources.

Listing metadata is cached for the invocation. Reads verify listed size and ETag
when available; a discovered version ID is sent in the read request. Results
retain returned version ID, ETag and SHA-256 of the bytes. Observed version IDs
are distinguished from explicitly version-pinned requests. Unversioned objects
are cached by their validated bytes after first read, not represented as an
atomic multi-file snapshot. Listing/read races detected by metadata fail explicitly;
start a new invocation to refresh. Changing credentials/configuration revision or
revoking the read grant prevents reuse of cached S3 text.

## Bounds and coverage

`workspace_files` supports:

- `list`: shallow directory metadata, paginated by `offset`/`limit`.
- `find`: case-insensitive literal substring matching on paths below `path`.
- `read`: UTF-8 text line windows, returning `startLine`, `totalLines`, `nextLine`.
- `search`: case-insensitive literal substring content search, with line numbers,
  per-file provenance, skipped/error reasons and continuation by file offset.

There is no regular-expression evaluation, symlink traversal or submodule traversal.
Read limits are 128 KiB per regular file, 200 lines and 16,000 characters per
window. A line too long for a window fails explicitly. Results contain at most
100 entries/matches; search examines at most 32 files per call. Walks stop at
2,000 files or 128 directories; S3 inventories read at most 20 listing pages.
Each invocation allows at most 32 source members, 256 context host requests and
16 MiB of context response bytes, within the existing Pi/codemode budgets.

Coverage states whether traversal/search finished and which directory/file range
was examined. Binary, oversized, unsupported or failed files are listed as
skipped. Additional matches omitted by a result limit are reported. Incomplete
coverage never proves absence; use a narrower path or read the specific file.
Stop, workspace navigation and required checkpoint failure prevent subsequent
reads/results from proceeding. Tool results and their provenance are saved in the
normal transcript; reload does not execute them again. A new explicit invocation
creates a fresh context snapshot, while old results retain their original pins.

Automated acceptance covers multiple repositories, changed remote heads, hostile
paths/blobs, revoked cached authorization, S3 binding/races, and production-browser
Pi → QuickJS → native Git/S3 → checkpoint → reload. Fixtures do not establish a
physical-device or live-provider acceptance run.

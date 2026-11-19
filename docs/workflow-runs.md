# Workspace workflow runs and local OTel SQL

Open **Workflow runs** from Workspace documents, or visit `app/#/runs`.
Choose a storage connection, storage repository and nugs workspace, plus an
Actions connection that can read the associated `gh-agentic-workflows` repository.
The storage and Actions connections can be different installations.

## What the first slice reads

This is a read-only compatibility consumer of existing, verified workspace
`workflow-runs/github-<id>/observability/attempts/<attempt>/<job>.json` pointers.
It resolves membership in the selected workspace snapshot **before** fetching
Actions metadata. It never scans global Actions history or infers membership
from a branch name. Attempts are separate entries, ordered by original run
creation time with stable identity tie-breaks. A shared run can be associated
with more than one workspace without copying its raw telemetry.

The inventory is bounded to 200 legacy pointers; exceeding the bound is an
explicit error. Local pagination is 20 attempts per page. Refresh by loading the
workspace again to pin a new snapshot. Existing legacy producers publish pointers
in their post-hook: unassociated/queued runs and newer typed-only executions are
not discoverable through this adapter. The authoritative typed S3 execution index
and early workspace associations remain the task-48v.2 integration boundary;
this feature does not create another catalog or write runtime state to Documents.

Visible rows load job-window timing in the background. Attempt detail shows the
job window (earliest start to latest completion), separately summed job time,
jobs, telemetry archive receipts, run-scoped existing GitHub artifacts and related
reviews. Parallel job sums are not wall time or billing time. Missing completion
timestamps yield unavailable timing rather than using `updated_at` as completion.

## S3 connection and outputs

Use **S3-compatible connections** in the extension's connection settings. Configure
the actual endpoint, region, bucket, addressing style, allowed publisher prefix
and provider key. Enable read/list; uploads are unnecessary. Approve the hosted
page's exact origin and directory subpath, then reload. A grant for sibling
`s3.html` does not imply access to `/app/`, or vice versa. See
[S3 connections](s3-connections.md) for the settings and credential boundary.

Select the approved telemetry S3 connection in attempt detail. No storage endpoint
is built into the app. The selected bucket/prefix must cover the pointer's exact
locator. The extension signs requests; no credentials are passed to the page,
DuckDB worker or SQL text. B2's actual bucket configuration still needs live
installed-extension acceptance; simulated provider tests do not establish it.

**Load private file outputs** lists only `workflow-files/github/<repo>/<run>-<attempt>/`
receipts under that publisher prefix. It displays receipt metadata and digests,
not an assertion that every payload is still retained. Telemetry reads verify the
workspace pointer against the S3 receipt, then verify archive and member digests.
No GitHub artifact uploads are added. Existing GitHub artifacts are labeled
run-scoped rather than attributed to an attempt without evidence.

## Local SQL

**Load verified telemetry** loads one selected job archive, not all jobs or an
entire workspace. Initial support decodes existing OTLP/protobuf transport
envelopes from `payload.tgz` into Arrow tables in memory. This makes historical
exports usable without first migrating publishers to derived Parquet shards.
OTLP JSON and newer unknown protobuf fields are not silently treated as decoded:
unsupported envelopes fail, and the UI labels the decoder schema and coverage.
Raw exports remain authoritative.

Available nonempty tables are `spans`, `span_events`, `span_links`, `logs` and
`metrics`. Resource/scope attributes and full decoded records/metric points are
retained as JSON-text columns. Nanosecond timestamps and int64 values remain
exact strings; cast deliberately in SQL. Histogram points retain their bucket
and temporality information in `point_json`. Missing signals or zero-record
tables are explicitly labeled, not inferred from a green Actions result.

DuckDB-Wasm and its matching Arrow major are explicitly pinned. The engine and
worker are hosted with the app, without a CDN or query server. The Wasm binary is
an explicit gzip asset, decompressed locally to remain within existing Pages
preview limits. The exception-handling bundle avoids the MVP bundle's masked
exception failures. Arrow import needs no downloaded JSON extension.

Pages publication also gzip-packs Mermaid and the lazy Monaco runtime/JSON
modules. Editor ESM entry URLs remain stable; the packer rebases parsed imports
and asset URLs before loading a local blob. It is restricted to those two editor
modules, whose exported API objects/functions are stable, rather than wrapping
arbitrary application exports. This preserves the combined app/Storybook 24 MiB
limit without CDN dependencies or requiring configurable HTTP encoding headers.

After loading the buffers, DuckDB external access/extension autoloading is disabled
and its configuration is locked. Enter one relational query without semicolons.
Results are bounded to 200 rows, 100 columns and 1 MiB of displayed text. Archives
are bounded to 8 MiB compressed / 32 MiB expanded, and normalized rows to 100,000 /
32 MiB estimated text. The worker uses a 128 MiB engine memory limit. Timeouts or
**Cancel / release dataset** terminate the worker; reload the export to continue.
SQL results and telemetry are not saved into page preferences.

Related reviews use exact version/snapshot pins from explicit associations.
Same-task reviews are separately labeled context and are never presented as
proven outputs. Legacy exports without relations show that absence explicitly.

## Iterate locally

From the dedicated source worktree:

```sh
pnpm install --frozen-lockfile
pnpm run webapp:dev
pnpm run test:runs
pnpm exec vitest run tests/workflow-runs.test.ts tests/connections.test.ts
pnpm exec playwright test tests/browser/telemetry-engine.spec.ts
```

The telemetry-engine command starts/stops its own local Vite server and exercises the actual
production engine with independently encoded golden OTLP data. It checks SQL
counts/durations and rejects external file access. It does not need S3 credentials.

`pnpm run test:runs` starts its own dev server and builds an isolated extension
inside the test profile. It exercises the complete route/extension/S3/SQL/review
journey without needing a prior hosted production build. Keep it separate from
an already running `webapp:dev` on port 3100. HTTP replies use independent golden
fixtures; the UI, extension relay, signing and DuckDB worker are production code.

For the packaged-extension and production-subpath journey:

```sh
pnpm run build
pnpm run hosted:build
pnpm exec playwright test tests/browser/workflow-runs.spec.ts
pnpm run check
pnpm run webapp:check
pnpm run lint:tsx-view-boundary
```

For the combined publication and compressed editor/diagram check, also run
`pnpm run webapp:storybook:build`, `pnpm run hosted:storybook:stage`, and
`pnpm exec playwright test tests/browser/static-documents.spec.ts`.

That browser test uses real extension settings, IndexedDB, grants, signing/relay,
production assets and the real SQL worker, with simulated GitHub/S3 HTTP replies.
It checks workspace membership (including a shared run), ordering, timing, exact
review links, source/member digests and blocked external SQL. Production component
states are also available in Storybook under **Workflows/Workspace runs**.

The Runs route is registered in the three-surface UI contract. Its stable
`WorkflowRuns.hooks.ts` feature owns state above presentation selection: phone
uses a collapsible workspace picker, tablet a workspace panel above content,
and desktop a persistent workspace sidebar. All share the same route, broker,
SQL engine and evidence renderers. The packaged-extension test rotates through
phone, tablet and desktop in portrait and landscape, checking that the selected
attempt, SQL draft/result, loaded dataset and exact review pin survive without
additional broker reads or page-width overflow. These are browser-emulated
application surfaces, not physical-device keyboard or WebView acceptance.

Required UI checks are `pnpm run lint:ui`, `pnpm run test:ui-policy`, and
`pnpm run webapp:check`. The hosted build includes the integration branch's
separate opt-in Pi page; the legacy payload check excludes its own files while
retaining the existing 66 KiB legacy and 24 MiB overall preview limits.

Keep fixture truth independent of the production converter: the golden protobuf
wire encoder hardcodes field numbers separately and expects exact span IDs,
timestamps, events, links and integer metrics. Follow fixture checks with actual
read-only S3/installed-extension verification before claiming live-provider
acceptance. Screenshots, traces and raw telemetry remain private, not Documents
or new GitHub Actions artifacts.

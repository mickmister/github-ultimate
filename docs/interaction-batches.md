# Read-only interaction batch review

`webapp/src/features/interactions` implements the validation/preview gate from
`specs/interaction-batches-v1/spec.md` (nugs version
`b675d567830ee9e44184f31feceff434e7cd945d`, task `task-0wr.15.5`). It is a shared
production module and React review surface, not an application executor.

## Input and compatibility

`importBatch(json, binding, legacyAdapter?)` strictly imports all items or returns an
error; it never silently drops an unknown item, creates replacement IDs, updates the
clipboard queue, or infers approval. The current feedback queue continues to export
v1. `documentsV1Adapter(binding)` explicitly identifies the current producer's
`revision` as a Git commit, validates repository/namespace, and retains IDs/versions.
Other v1 producers need their own adapter. V2 composition uses `validateBatch` with
typed content/feature comments, editable annotations and one Beads changeset group.

The selected `binding` is host-provided workspace/collection context, not values
copied from imported JSON. Workspace refs must not be invented from namespaces.
The present Documents discovery contract does not expose that opaque registry
binding, so mounting this reviewer requires an embedding host which has resolved it;
it is not automatically mounted in the ordinary Documents route yet.

Unlike the original draft, `pageUrl` is optional to match the current UI's opt-in
capture policy. Rendered `textRange` is retained alongside quotes/context; it is not
converted into Markdown source positions. Neither adaptation adds URL data.

## Resolve and preview

```ts
import { createHostedInteractionServices } from '../webapp/src/app-hooks/interactions';
import { importBatch, documentsV1Adapter } from '../webapp/src/features/interactions/batch';
import { previewBatch } from '../webapp/src/features/interactions/preview';

const services = createHostedInteractionServices(scope, verifiedBinding, documentsCommit, adapters);
const batch = importBatch(clipboardJSON, verifiedBinding, documentsV1Adapter(verifiedBinding));
const preview = await previewBatch(batch, verifiedBinding, services, abortSignal);
```

`currentDocumentAdapters(hostBuild)` supplies the concrete current feature registry
and sanitized Markdown text representation for that exact host build. Historical
builds and asynchronously rendered diagrams remain unsupported until an exact
adapter is provided; callers do not register the untrusted export's build as current.

`createGitResourceResolver` uses the existing installation-scoped Git broker and
`WorkspaceReader` blob integrity verification. Commit references resolve exact
document-relative paths through that immutable tree. Blob references must occur in
the host's selected pinned Documents tree. Missing/ambiguous membership, substituted
scopes, unsafe paths, identity mismatches and corrupt bytes block review. Digest-store
references require a separate trusted resolver; they are not reinterpreted as Git OIDs.
Opaque requested document IDs remain capture metadata; the resolved path/blob/commit
is the verified snapshot-entry identity, not a claim to have resolved the future
stable-document-ID index. PNG/JPEG/etc. dimensions use the browser image decoder.

Previews retain every validated item, its payload, native operation IDs and a stable
`item/<id>` effect identity. Each item digest uses canonical JSON over the workspace
binding and item, excluding export ID/time. Re-exporting unchanged items in another
batch does not change their effect identity/digest. This prepares replay checking;
enforcing create-only markers remains the later application gate.

Rows report `ready`, `conflict`, `unsupported` or `unavailable`, plus exact pinned
resource identity, anchor state and diagnostics. Every group must be ready for the
whole preview to be ready. This is **ready for review**, never acceptance, application
or a persistence receipt. There is no global cross-ref atomicity promise.

Source model selections validate exact UTF-16 line/column ranges and captured text,
then derive UTF-8 source offsets. Quotes resolve only in the exact representation;
missing/duplicate matches are orphaned/ambiguous, not silently retargeted. UI highlight
heuristics may be more permissive; authoritative previews intentionally do not reuse
whitespace-fuzzy highlight matching. Rendered Markdown needs an exact renderer/build
adapter; source text is never passed off as rendered content.

## Trusted adapter capabilities

- `feature(featureId, appBuild)` recognizes a known application feature/build.
  Feature feedback targets that feature; any displayed document is reproduction
  context, not the feature's mutation target.
- `representation(resource, representation, appBuild)` supplies exact text for a
  known renderer/build. Without it, rendered selections remain visibly unsupported.
- `annotations` maps known schema IDs to in-process native-payload validators which
  return valid editor element IDs. Image regions also compare against decoded image
  dimensions. Unknown editor payloads remain intact and visibly unsupported.
- `native(request, signal)` is a read-only storage capability returning issue
  existence, labels and optional row-version tokens from the independently selected
  `binding.doltCommit`. The result must match workspace/collection/commit. This
  commit may differ from the client's observed provenance commit; only declared
  membership/optional row guards conflict. The production Beads Worker adapter is
  not installed by this change. Missing capability blocks the native row, rather
  than approving fixture data. Native write support remains separate.

Adapters are host code, never URLs or commands supplied in a packet. The preview is
cancelled on editor/context changes and unmount. Broker reads currently cancel
cooperatively between operations; this does not add transport-level cancellation.

## Production component and verification

`InteractionReview` accepts `binding` and `services` props, an explicit v1 adapter
checkbox and pasted JSON. It presents all row/group results and preserves original
intent in expandable details. Storybook `Web app / Interactions` uses this component
with declared fixture transport/native/editor adapters, not a parallel story-only UI.

Tests cover verified Git bytes/corruption and membership, v1/URL/text-range
compatibility, mixed groups, stable re-exports, source Unicode offsets, stale and
ambiguous anchors, unsupported capabilities, image bounds/dimensions, relaxed native
guards, native scope substitution and cancellation. Browser checks exercise the
real review surface and existing feedback copy-and-clear behavior. Fixture native
snapshots are not a proof of native storage transactions or live authentication.

Next gates are host binding/route integration, concrete rendered/editor/native
adapters, then per-ref/native transaction markers and direct/review publication.
Opening a review or copying JSON does not dispatch an agent or alter Beads.

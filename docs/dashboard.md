# Workspace dashboard v2

The hosted app is a small engineering-dashboard shell with composable workspace
views. The default page is the workspace chooser; `#/workspace?...` is a deep-linkable
workspace detail view. `settings.html` retains the original connection/read demo as
advanced settings. All routes work under the same static Pages branch preview.

## Workspace discovery and access

The chooser enumerates repositories from every approved, signed-in connection's
selected installation. It scans existing document/Dolt refs and verifies the
required `workspace/manifest.json` before offering a workspace. Storage namespaces
without a valid manifest, including Dolt-only recovery refs, are counted as
incomplete discovery results rather than presented as valid workspaces.

Identity is `(storage repository, namespace)`. Multiple connections may provide
access to that identity; the card preserves the separate access routes instead
of inventing App ownership or duplicate workspaces. The last chosen route is
preferred where still available. Changed/unavailable saved access requires an
explicit selection. Opening a detail URL never retries with another credential.
The extension continues to enforce exact-origin approval, selected installation
identity, repository access, response bounds, shared rate limits and cache scope.

Discovery is serial, with batches of at most 12 repository/manifest tasks and a
user-controlled **Load more workspaces** action. One task can require several
bounded Git reads. This is not background polling or an exhaustive unbounded scan.
Incomplete namespaces and per-route errors are surfaced; rate limits stop a batch
without trying another credential. The saved navigation record is shared between
the preview's root, index and settings pages, but isolated from other previews.
The landing page stays a chooser; the last workspace is highlighted rather than
forcing navigation away from it.

## Built-in views and current boundary

- **Beads** is the default detail app. It reads the authoritative Dolt storage
  manifest and snapshot metadata. Actual issue/graph queries still require the
  read-only browser engine tracked by `task-0wr.8`; metadata is not task browsing,
  and archived JSONL is not a substitute.
- **Documents** opens the captured document commit in github.dev, with individual
  file links as well. The workspace header exposes **Open in github.dev** directly.
  Full Git object IDs pin custom-ref snapshots. GitHub authentication is separate;
  github.dev publishing does not implement nugs' version-checked custom-ref writes.
- A native Monaco tree/editor and custom document review/editing interfaces remain
  planned in `task-0wr.16`, behind Beads. No document write capability is exposed by
  the current broker.

## Extending the UI

`hosted/workspace-apps.ts` declares trusted lazy-loaded modules by stable app ID,
semantic kind ID, title and description. Kind IDs are strings, not an exhaustive
enum. Multiple installed apps can visualize the same kind. `WorkspaceAppContext`
carries the selected access route, validated manifest, pinned document snapshot,
scoped reader and an AbortSignal for navigation changes. App failures do not
require replacing the workspace shell.

To add a compiled-in view:

```ts
// hosted/apps/review.ts
import type { WorkspaceAppContext } from '../workspace-apps';

export function mount(root: HTMLElement, context: WorkspaceAppContext) {
  const title = document.createElement('h2');
  title.textContent = `Review ${context.opened.manifest.workspace}`;
  root.append(title);
  // Use scoped typed reads; discard late results when context.signal is aborted.
}
```

Then register a definition with `id: 'review.documents'`, `kind: 'documents'`, and
`load: () => import('./apps/review')`. Type-specific renderers/layout composition can
be built on this seam. A manifest or stored nug never supplies executable code,
credentials or arbitrary privileged endpoints. Adding a genuinely new backend or
GitHub operation requires a corresponding bounded adapter/broker capability.

## Broader nug model

The user-directed dashboard spans Beads, documents/review, test-result analysis,
OTel analysis and agent conversations, and must accommodate user-defined types.
Semantic meaning, format/schema, storage binding and sync behavior are separate
axes. Built-ins are presets, not the limit of the product; test analysis/review
use cases do not automatically establish new implemented storage kinds.

Messages preserve original user intent and agent responses, without tool calls or
results. They work independently of native sessions. Sessions specifically mean
genuinely resumable native state and are deferred; a raw export alone is not proof
of resumption. OTel capture/backend/retention is still undecided, so no Git/S3
backend is inferred from its file encoding. UI extension points do not claim those
storage APIs or semantics have been implemented. Follow-ups are recorded under
`task-0wr.15` and linked to the existing nugs direction.

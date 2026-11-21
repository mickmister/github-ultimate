# Attachable UI feedback

The React app provides a shared comment queue for useful dynamic UI. It currently
attaches to document rendering, Monaco source and individual document-tree files.
Right-click an attached area, or use its visible **Comment ⋯** / row overflow
button. Shift+F10 or the keyboard Context Menu key opens actions for a focused
attached element. Touch users can select text normally, then use the visible
button; we do not replace iOS's native text-selection long press.

The Ark UI menu offers **Copy**, **Comment on Content**, and **Comment on Feature**.
Copy writes the highlighted text, without adding a queued item. It is disabled
without a selection. Content comments require an attached resource; feature
comments also work on sections such as the whole document tree.

Comments capture the UI path, stable element/feature identifiers,
application build commit, resource identity/revision and highlighted text when
the menu opens. Content comments address the resource revision. Feature comments
address the application feature/build and retain the resource as reproduction
context. DOM ranges supply rendered text with quote context; source uses Monaco's
model selections and line/column ranges. Rendered-text positions are not claimed
to be Markdown source positions. No whole-document/React-props dump is captured.
The current browser URL is omitted by default, including from stored drafts and
exported events. Location is represented by the explicitly supplied target and
resource fields; these should contain only context the embedding app needs.

## Queue and clipboard

**Comments · N** opens the review dialog. Edit or remove items, then choose
**Copy review & clear** and paste the compact Markdown review into agent chat.
Repository and workspace are included once per scope, with a heading and exact
revision for each document. Each numbered comment contains only the highlighted
text and the verbatim comment. Source selections include their actual line ranges;
rendered selections do not invent Markdown source positions. Whole-document
comments need no quote. Feature comments are explicitly labeled with their feature
identifier so they remain distinguishable from feedback on document content.

Prefix/suffix context and internal IDs, build metadata and timestamps stay out of
the copied review. Full capture data, including anchors used to locate highlights,
remains in the internal versioned draft until the comment is cleared. An embedding
app that explicitly opts into browser URLs also gets a Page line in the review.

Drafts use tab-scoped `sessionStorage` under `github-ultimate:feedback:v1` and
survive reloads and navigation. If storage fails, comments remain usable in memory
and the UI reports the save failure. Clipboard failure keeps the queue intact.
Only unchanged items included in a successful export are removed; newly added
or edited comments survive an in-progress export. A successful clipboard write
means the text was copied, not that an agent received or acted on it.

Clipboard access requires a secure origin and browser permission/user activation.
Use the actual Copy button; if the browser denies access, retry without losing
the draft. Workflow dispatch and server-side comment publication are future work.

## Inline document comments

Queued comments on the open document appear beside their selected passages.
Rendered Markdown uses non-destructive highlight overlays; source uses Monaco
model decorations, including multiple selected ranges. Numbered indicators and
clicking a highlighted passage focus its side comment. **Show passage** scrolls
back to the selection. Overlapping comments retain separate indicators and
non-overlapping comment cards. On narrow screens the cards stack below the
document, with touch-sized indicators beside the text.

Edit or delete a comment beside the document or in **Comments · N**. Both views
use the same queue, so changes persist across reloads and deleting/exporting a
comment removes its indicators. Comments without selections remain visible as
whole-document comments. Resource kind/ID, repository, workspace, path and
revision must match before a comment is shown on a document.

New rendered selections include `selection.textRange` text-node offsets within
the content region, excluding toolbars and feedback controls. These are **not
Markdown source offsets**. Saved offsets are checked against the quote; older
drafts can be anchored using the quote and its surrounding context. Ambiguous
or missing passages stay in the side list with an explanation rather than
highlighting a guessed match. Comments selected in another representation
remain visible, with **Show selected view** for Markdown/source switching.

The reusable `FeedbackAnnotations` component accepts the same `FeedbackTarget`
as its enclosing `AttachableContext`, plus an optional `showRepresentation`
callback. Wrap the actual content renderer, not its toolbar:

```tsx
<AttachableContext target={target}>
  <FeedbackAnnotations target={target}>
    <DocumentContent />
  </FeedbackAnnotations>
</AttachableContext>
```

Non-DOM editors can register an annotation adapter with
`registerFeedbackAnnotations` for decoration updates, positioning, revealing a
selection and layout/scroll notifications. Disposing the editor unregisters the
adapter. Neither annotations nor their positioning add URLs to feedback events.

## Integrating another production component

Mount `FeedbackProvider` above the router or panels. The app root already does
this. Standalone document presentations also provide it; nested providers reuse
the existing queue/menu, so a page never gets duplicate feedback UI.
The outermost provider owns configuration; nested providers cannot opt a parent
queue into collecting URLs.

Each application can configure its own tab-draft key. URL capture requires an
explicit opt-in at that application's provider:

```tsx
// Default: no browser URL is read or included.
<FeedbackProvider storageKey="my-app:feedback:v1">
  <App />
</FeedbackProvider>

// Only if this application deliberately needs browser URLs:
<FeedbackProvider storageKey="another-app:feedback:v1" includePageUrl>
  <AnotherApp />
</FeedbackProvider>
```

`pageUrl` is optional in schema version 1. Old URL-bearing drafts remain readable;
with the default policy their URLs are removed when loaded and the sanitized
draft is saved again. Turning off `includePageUrl` also removes URLs from queued
comments. Turning it on does not reconstruct URLs omitted from earlier captures.

```tsx
<AttachableContext target={{
  elementId: `run-summary:${run.id}`,
  label: 'Workflow run summary',
  uiPath: ['Runs', 'Summary'],
  featureId: 'runs.summary',
  representation: 'rendered-text',
  resource: { kind: 'workflow-run', id: run.id, revision: run.revision },
}}>
  <RunSummary model={run} />
</AttachableContext>
```

UI paths are relative to enclosing attachable contexts. Nested boundaries inherit
resource context unless explicitly replaced; the closest boundary owns the event.
`asChild` attaches handlers/ref/data attributes to one existing element without
changing layout or tree semantics. The child must forward those props and its ref
to a DOM element. Existing handlers/ref are composed. Use `showButton={false}`
with `asChild` and place a `FeedbackTrigger` inside the element for its visible
overflow action, as document-tree rows do. A boundary with no visible action can
still use right-click/Shift+F10; provide a visible section action for touch access.

Widgets with non-DOM selection register a `registerFeedbackSelection(element,
capture)` adapter and dispose it with the widget. Monaco uses this to keep exact
source selection while its toolbar/menu changes focus. Its default context menu
is replaced within the explicitly attached source boundary.

The shared menu uses controlled Ark Menu positioning against the captured point;
the wrapper owns invocation so it can freeze selection before menu focus changes.
Queue/controller logic is independent of Ark and document-browser actions.
Intrinsic JSX remains in view files. Public styling variables are
`--feedback-panel`, `--feedback-fg`, `--feedback-accent`, `--feedback-selected`, and
`--feedback-radius`; the defaults follow the app's light/dark colors. Annotation
colors expose `--feedback-highlight`, `--feedback-highlight-active` and
`--feedback-highlight-border`.

Stories use the real feedback and rendering components. **Web app → Feedback →
Nested targets** demonstrates composition. The document-browser stories exercise
the production reader, source editor and tree integrations. **Web app → Feedback
→ Inline comments** demonstrates the production annotation wrapper: select text
and queue comments to see, edit and remove their indicators.

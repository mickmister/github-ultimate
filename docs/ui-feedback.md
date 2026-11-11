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
**Copy JSON & clear** and paste the result into agent chat. The versioned JSON
envelope contains a batch ID, export timestamp and ordered `interactions`.
Each interaction has its own ID, version, kind, comment and captured context.

Drafts use tab-scoped `sessionStorage` under `github-ultimate:feedback:v1` and
survive reloads and navigation. If storage fails, comments remain usable in memory
and the UI reports the save failure. Clipboard failure keeps the queue intact.
Only unchanged items included in a successful export are removed; newly added
or edited comments survive an in-progress export. A successful clipboard write
means the text was copied, not that an agent received or acted on it.

Clipboard access requires a secure origin and browser permission/user activation.
Use the actual Copy button; if the browser denies access, retry without losing
the draft. Workflow dispatch and server-side comment publication are future work.

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
`--feedback-radius`; the defaults follow the app's light/dark colors.

Stories use the real feedback and rendering components. **Web app → Feedback →
Nested targets** demonstrates composition. The document-browser stories exercise
the production reader, source editor and tree integrations.

# Review loading and local performance capture

Review deep links load only the selected request's manifests, responses,
acknowledgements and current reviewer's drafts. They do not scan other packets'
blob contents. Pinned manifest opening runs alongside current receipt discovery;
the editable session mounts after saved state is available, preserving remote
draft restoration and submitted-answer precedence. Inbox cache restoration runs
alongside live loading; late cached results cannot replace a completed live load.

Review Git reads share a four-request concurrency limit. Scoped readers reuse
immutable snapshot lookups, evict failed lookups for retry, and retain at most
sixteen readers/snapshots per cache. Existing broker authorization, integrity
verification and durable Documents caching remain in force. Other reviewers'
draft paths are excluded before fetching their blobs.

## Capture a slow session

Open **Performance diagnostics** on the review page. Start capture, reproduce a
load with **Check for updates and receipts** or navigate within the app, stop,
and export JSON. Capture is device-local and in memory, off by default, and
bounded to 2,000 completed spans. Nothing is uploaded automatically.

The same commands are available in the browser console after opening Reviews:

```js
reviewPerf.start()
// Reproduce the slow operation.
console.table(reviewPerf.summary())
reviewPerf.stop()
reviewPerf.download()
// Or obtain the object without downloading:
reviewPerf.export()
reviewPerf.clear()
```

The export uses OpenTelemetry OTLP JSON trace format (`resourceSpans`,
`scopeSpans`, nanosecond timestamps, hex trace/span IDs). It is a lightweight local
capture, not an installed OpenTelemetry SDK or an automatically configured OTLP
exporter. Operation totals can overlap; do not sum them as elapsed page time.

Spans cover review loads, pinned opening/reads and credential-broker round trips.
They omit document/form bodies, answers, credentials, request paths, URLs and
error messages. A failed operation is represented by its status. Bridge spans
include broker authorization, cache and network time together; they do not expose
separate GitHub server timing or CPU/rendering/long-task measurements yet.

Cross-workspace indexes, GraphQL batching and broker-internal/network/render
spans are separate follow-ups. The current improvement changes read scheduling
and selection, not review publication or response storage formats.

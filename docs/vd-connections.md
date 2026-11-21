# VD / Vibe Kanban review continuation

The hosted review UI uses the extension background broker or Alohak native host.
No webhook, callback listener, or page-owned VD credentials are needed.

## Connect

In extension connection settings or Alohak **Native settings**, add a VD connection:

- A name and HTTPS API origin, without path/query/embedded credentials. HTTP loopback is supported for local development; loopback refers to the client device.
- Authentication headers for your deployment, marked secret or plaintext.
- The storage repository, readable nugs workspace handle and VK workspace UUID.

**Test VD connection** performs an uncached, read-only `GET /api/workspaces` with
the current editor, including retained saved secrets. It verifies that the configured
workspace is visible; it does not send an agent message or prove mutation permission.
Save the connection and grant the hosted origin/subpath **VK continuation** access.
This grant is separate from GitHub connection access. Hosted **Connection & storage
settings** can display approved VD bindings. Credentials are edited in privileged
extension/native settings, not the hosted page.

Saved secret values are never returned to the editor. Leave them untouched to retain,
enter replacements to rotate, or remove a header. A changed VD origin requires explicit
replacement values. Redirects and ambient browser cookies are not used. Requests have
a 20-second deadline, bounded responses and no automatic mutation retry.

Extension headers live in extension-origin IndexedDB. Native headers live in
SecureStore, available while unlocked; native settings and delivery receipts are
separate. Native header records are limited to 1800 UTF-8 bytes. Settings are local
to the device; configure each device deliberately.

## Publish and submit

`cli/review.ts publish` automatically adds the following when both environment IDs
are present:

```json
{"response_effect":{"kind":"vk-session","workspace_id":"<VK_WORKSPACE_ID>","session_id":"<VK_SESSION_ID>"}}
```

Amendments preserve their existing origin. `--vk-origin handoff` explicitly rebinds
to the current environment; `--vk-origin none` suppresses the field. Partial/invalid
environment pairs fail publication. Explicit QRSPI `process` metadata retains the
Actions continuation path; captured VK context does not also start a VK turn.
Requests with neither binding only save responses.

Normal review **Submit** persists and reads back an immutable response first, then
resolves exactly one approved VD connection for its storage/VK workspace binding.
The broker verifies the exact session, nonarchived workspace, queue and activity.
Idle sessions receive `/follow-up`; busy sessions with empty queues receive `/queue`.
An occupied or changed queue retains the saved response and asks the user to resolve
it in VD before retry. It never silently appends or overwrites observed queued work.
The VD queue has no atomic CAS: interclient races remain possible, and queue acceptance
is not proof that the message eventually executes. Session executor is preserved;
the adapter uses the same executor-only shape as Handy Actions, not a new profile selector.

The agent notification carries exact response pins and directs the agent to validate
the request/form pins stored inside it and respect discussion versus implementation
intent. Notification acceptance does not establish completed review processing.
Superseded request revisions save answers without automatic VK continuation.

## Recovery

Review save and VK delivery have separate receipts. A missing connection or failed
preflight leaves the response saved; **Retry delivery of saved response** reuses it.
The host journals intent before POST and stores the accepted process/queue receipt.
Accepted or uncertain sends are not automatically replayed, including after restart
or credential rotation. For an uncertain send, inspect the destination for its
`[review-response:<blob>]` marker; do not create another response just to retry it.

Receipts are device-local. They prevent local replay but cannot promise exactly-once
delivery across devices, browser profiles, local storage deletion, or concurrent
clients. There is no always-on background daemon: closing/suspending the host can
leave work pending or uncertain. Standalone web-without-bridge access and durable
server-side admission are separate capabilities.

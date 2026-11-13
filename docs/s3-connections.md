# S3-compatible object storage

The extension can broker bounded reads, listing and uploads to user-configured
S3-compatible HTTPS endpoints. HTTP loopback is supported for local development.
The hosted object browser is published at `s3.html` alongside each preview's
dashboard and `/app/` document browser. The document browser links to it.

## Configure a connection

Open **GitHub App connections** in the extension and use **S3-compatible
connections**. Enter a connection name, API endpoint, bucket, signing region,
path-style or virtual-hosted addressing, allowed key prefix and access/secret
keys. An optional session token is supported. Region defaults to the standard
`us-east-1`; change it to the value required by your service, such as `auto`.
No personal endpoint, bucket or key prefix is built into the extension.

- Path style requests `endpoint/bucket/key`; virtual-hosted style requests
  `bucket.endpoint/key`. API endpoint path prefixes are retained.
- A nonempty allowed prefix is normalized with a trailing `/`, so `workspace-a`
  permits keys under `workspace-a/`, not `workspace-ab/`. An empty prefix permits
  the whole configured bucket. Keys are case-sensitive S3 keys, not local file
  paths. Literal `%`, spaces and slash structure are encoded once; dot segments
  and control characters are not supported in requested keys.
- Enable read/list and upload independently. Replacement is a separate setting,
  disabled initially. Create-only uploads send a signed `If-None-Match: *`.
  Your service must support that conditional request. An existing key returns
  an error; there is no retry that silently drops the condition. Enabling
  replacement explicitly permits ordinary PUT replacement at the service.
- Editing a connection requires re-entering its credentials and retains its
  hosted grants. Each configuration edit changes a revision: open pages must
  reconnect before operating on changed endpoints, buckets, prefixes or rights.
  An old page cannot silently upload to a newly configured destination.
- Removing a connection removes its locally stored credentials and grants. It
  does not revoke credentials at the storage provider.

Browser host access is requested for the effective bucket endpoint. Add each
allowed hosted origin/subpath pair to the connection separately. Grants follow
the original loaded document path, using the same rules as GitHub connections.
For the standalone browser you can approve the preview directory or the specific
`/path/to/s3.html` entry point. Reload the page after first approval or updating
the extension. These grants do not grant any GitHub App connection access.

## Browse, read and upload

The page connects automatically. A single approved connection is selected
automatically; otherwise choose one. The last selected connection, listing prefix
and object key are remembered as page-local navigation hints. If that connection
is no longer available, choose another explicitly; no fallback is used. With
read/list enabled, returning to the page loads the object list automatically.
**Forget storage selection** clears those hints.

Listing uses ListObjectsV2 with at most 100 objects per page and an opaque
continuation token. **Next page** replaces the displayed page. Reads and uploads
are limited to 8 MiB per object; listing XML is limited to 2 MiB. Truncated or
out-of-prefix responses are rejected. There are no multipart uploads or deletes.

Choose an object key and **Read object** for an inert UTF-8 preview or download.
HTML/script bytes are displayed as text, never executed. Choose a local file to
prefill its key under the allowed prefix, edit the key if needed, then use
**Upload object**. The receipt shows the key, byte count and any ETag/version ID
the service returned. Provider errors are surfaced without logging response
bodies or returning signing headers/credentials. Object bodies and upload files
are not saved in page preferences.

## Direct and review uploads

Configure a direct-bucket connection for streamlined uploads. Configure a separate
staging-bucket connection, with its own credentials, prefix and operation grants,
for review uploads. The user chooses the destination connection explicitly.

This slice performs object transfers. Creating immutable intent-submission
snapshots, attaching those snapshots to a review and applying approved changes
is a separate workflow integration; an upload receipt is not a reviewed intent.
This also does not replace Git-backed workspace/native Beads synchronization.

## Transport and verification

Credentials live in extension-origin IndexedDB, separated from the storage area
available to GitHub content scripts. SigV4 signing uses `aws4fetch` in the
background. Hosted requests select only a connection revision, object key/prefix
and typed operation; they cannot select arbitrary endpoints, HTTP methods or
headers. Every request checks current original-document grants, operation rights,
key prefix and endpoint host permission before fetching. Requests omit browser
cookies, reject redirects, use a timeout and have no automatic retry loop.

Chrome extension-background fetch with endpoint host permission does not require
the bucket's page-origin CORS configuration. Direct page/content-script requests
would require CORS, whose origin rules cannot enforce hosted page subpaths. IAM
or service credentials still determine actual bucket/object access.

Unit fixtures verify signed requests, literal key encoding, pagination, binary
uploads, operation/prefix denial, transfer bounds, create-only replacement,
configuration revisions and credential rotation. Packaged Chromium tests use
the real extension relay, settings, IndexedDB and hosted browser with simulated
S3 network responses. They cover upload/read, inert previews, remembered
selection, restart persistence, sibling-path denial, open-tab revocation and
upgrading existing GitHub credential storage without losing its records.

Those fixtures are not live acceptance for every S3-compatible vendor. Verify
the target service's endpoint, region, addressing and conditional-write behavior
with its configured connection. Signed Safari/iOS host-permission and transfer
acceptance remains an actual-device check; a Safari bundle build alone does not
establish it.

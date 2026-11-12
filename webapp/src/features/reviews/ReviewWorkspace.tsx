import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppHooksV1, ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import type { ReviewListing } from '../../app-hooks/reviews';
import type { OpenReview } from '../../../../hosted/reviews';
import { reviewOid, requestResource } from '../../../../src/review-protocol';
import { ReviewWorkspaceView } from './ReviewWorkspace.view';

export interface ReviewLocation { connection?: string; repository?: string; workspace?: string; version?: string; snapshot?: string; requestId?: string }
export function parseReviewSearch(search: Record<string, unknown>): Omit<ReviewLocation, 'requestId'> {
  return Object.fromEntries(['connection', 'repository', 'workspace', 'version', 'snapshot'].filter(key => typeof search[key] === 'string').map(key => [key, search[key]]));
}
export function reviewHref(scope: WorkspaceScope, request?: OpenReview) {
  const query = new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace });
  if (request) { query.set('version', request.pin.version); query.set('snapshot', request.pin.snapshot); }
  return `#/reviews${request ? `/${request.request.request_id}` : ''}?${query}`;
}
export function ReviewWorkspace({ appHooks, location = {} }: { appHooks?: AppHooksV1; location?: ReviewLocation }) {
  const hooks = useMemo(() => appHooks ?? createHostedAppHooks(), [appHooks]);
  const [connections, setConnections] = useState<readonly ConnectionDTO[]>([]);
  const [connectionId, setConnectionId] = useState(location.connection ?? '');
  const [repository, setRepository] = useState(location.repository ?? '');
  const [workspace, setWorkspace] = useState(location.workspace ?? '');
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [listing, setListing] = useState<ReviewListing | null>(null);
  const [opened, setOpened] = useState<OpenReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  async function load(next: WorkspaceScope, initial = false) {
    const token = ++generation.current;
    setBusy(true); setError('');
    if (!scope || JSON.stringify(next) !== JSON.stringify(scope)) { setListing(null); setOpened(null); }
    try {
      if (!hooks.modules.reviews) throw new Error('This host does not provide review requests.');
      try {
        const cached = await hooks.modules.reviews.listCached?.(next);
        if (cached && generation.current === token) { setScope(next); setListing(cached); }
      } catch { /* Partial cache or a host without persistence; use fresh reads. */ }
      const found = await hooks.modules.reviews.list(next);
      let review: OpenReview | null = null;
      if (initial && location.requestId) {
        if (location.version || location.snapshot) {
          const version = reviewOid.parse(location.version), snapshot = reviewOid.parse(location.snapshot);
          review = await hooks.modules.reviews.open(next, { resource: requestResource(location.requestId), version_kind: 'git-blob', version, snapshot });
        } else review = found.requests.find(item => item.request.request_id === location.requestId) ?? null;
        if (!review) throw new Error('This review request was not found in the selected workspace.');
      }
      if (generation.current !== token) return;
      setScope(next); setListing(found);
      if (initial) setOpened(review);
    } catch (cause) {
      if (generation.current === token) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/access denied|HTTP (401|403|404)|no approved|not approved|sign in|access changed/i.test(message)) { setListing(null); setOpened(null); }
        setError(message);
      }
    }
    finally { if (generation.current === token) setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    void hooks.modules.documents.connect().then(async found => {
      if (cancelled) return;
      setConnections(found);
      const selected = location.connection ? found.find(item => item.id === location.connection) : found.length === 1 ? found[0] : undefined;
      if (!selected) { if (location.connection) setError('The linked connection is unavailable. Select an approved connection.'); return; }
      setConnectionId(selected.id);
      if (location.repository && location.workspace) await load({ connectionId: selected.id, installationId: selected.installationId, repository: location.repository, workspace: location.workspace }, true);
    }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; generation.current++; hooks.modules.documents.dispose(); };
  }, [hooks]);
  const selected = connections.find(item => item.id === connectionId);
  return <ReviewWorkspaceView connections={connections} connectionId={connectionId} repository={repository} workspace={workspace}
    scope={scope} listing={listing} opened={opened} busy={busy} error={error} service={hooks.modules.reviews}
    actions={{ setConnectionId, setRepository, setWorkspace, load: () => selected && void load({ connectionId: selected.id, installationId: selected.installationId, repository: repository.trim(), workspace: workspace.trim() }, true),
      refresh: () => scope && void load(scope), updateListing: setListing }} />;
}

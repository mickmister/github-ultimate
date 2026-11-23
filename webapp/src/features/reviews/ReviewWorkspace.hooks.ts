import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppHooksV1, ConnectionDTO, WorkspaceScope } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import type { ReviewListing } from '../../app-hooks/reviews';
import type { OpenReview } from '../../../../hosted/reviews';
import { reviewOid, requestResource } from '../../../../src/review-protocol';
import { installReviewPerf, measure } from '../../../../hosted/performance';
import { useReviewStoragePicker } from './useReviewStoragePicker';
import { saveReviewCategory, withReviewCategory, type ReviewQueueFilter } from './queue';

import type { ReviewLocation } from './navigation';
export { parseReviewSearch, reviewHref, type ReviewLocation } from './navigation';
export function useReviewWorkspaceFeature({ appHooks, location = {} }: { appHooks?: AppHooksV1; location?: ReviewLocation }) {
  const hooks = useMemo(() => appHooks ?? createHostedAppHooks(), [appHooks]);
  const [connections, setConnections] = useState<readonly ConnectionDTO[]>([]);
  const [connectionId, setConnectionId] = useState(location.connection ?? '');
  const storage = useReviewStoragePicker(hooks.modules.documents, connections, connectionId, location);
  const { repository, workspace } = storage;
  const [queueFilter, setQueueFilter] = useState<ReviewQueueFilter>('active');
  const [categorizing, setCategorizing] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState('');
  const savingCategory = useRef(false);
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [listing, setListing] = useState<ReviewListing | null>(null);
  const [opened, setOpened] = useState<OpenReview | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  async function load(next: WorkspaceScope, initial = false) {
    const token = ++generation.current;
    setBusy(true); setError('');
    if (!scope || JSON.stringify(next) !== JSON.stringify(scope)) { setListing(null); setOpened(null); }
    try {
      if (!hooks.modules.reviews) throw new Error('This host does not provide review requests.');
      const service = hooks.modules.reviews;
      const requestId = (initial ? location.requestId : opened?.request.request_id) ?? undefined;
      const pinned = initial && requestId && (location.version || location.snapshot)
        ? { resource: requestResource(requestId), version_kind: 'git-blob' as const, version: reviewOid.parse(location.version), snapshot: reviewOid.parse(location.snapshot) } : undefined;
      // A pinned detail link has everything needed to open the exact request.
      // Show it and start member downloads before discovering current refs or
      // restoring receipts. Those operations are not on the reading critical path.
      if (pinned) {
        const exact = await measure('reviews.openPinned', () => service.open(next, pinned));
        if (generation.current !== token) return;
        setScope(next); setOpened(exact);
      }
      // Cache restoration must not delay the live path. A late cached result must
      // never overwrite live receipts or a draft the user has started editing.
      let liveFinished = false;
      if (!requestId) void service.listCached?.(next).then(cached => {
        if (cached && !liveFinished && generation.current === token) { setScope(next); setListing(cached); }
      }).catch(() => {});
      const found = await measure('reviews.load', () => service.list(next, requestId).finally(() => { liveFinished = true; }));
      let review: OpenReview | null = null;
      if (initial && location.requestId) {
        if (!pinned) {
          review = found.requests.find(item => item.request.request_id === location.requestId) ?? null;
          if (!review) throw new Error('This review request was not found in the selected workspace.');
        }
      }
      if (generation.current !== token) return;
      setScope(next); setListing(found);
      if (initial && !pinned) setOpened(review);
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
    installReviewPerf();
    setInitializing(true);
    let cancelled = false;
    void hooks.modules.documents.connect().then(async found => {
      if (cancelled) return;
      setInitializing(false);
      setConnections(found);
      const selected = location.connection ? found.find(item => item.id === location.connection) : found.length === 1 ? found[0] : undefined;
      if (!selected) { if (location.connection) setError('The linked connection is unavailable. Select an approved connection.'); return; }
      setConnectionId(selected.id);
      if (location.repository && location.workspace) await load({ connectionId: selected.id, installationId: selected.installationId, repository: location.repository, workspace: location.workspace }, true);
    }).catch(cause => { if (!cancelled) setError(String(cause)); })
      .finally(() => { if (!cancelled) setInitializing(false); });
    return () => { cancelled = true; generation.current++; hooks.modules.documents.dispose(); };
  }, [hooks]);
  const selected = connections.find(item => item.id === connectionId);
  function resetSource() { generation.current++; setScope(null); setListing(null); setOpened(null); setError(''); setCategoryError(''); setBusy(false); }
  async function categorize(requestId: string, category: 'active' | 'dismissed') {
    if (!scope || !listing || !hooks.modules.reviews || savingCategory.current) return;
    const review = listing.requests.find(item => item.request.request_id === requestId);
    if (!review) return;
    const token = generation.current;
    savingCategory.current = true; setCategorizing(requestId); setCategoryError('');
    try {
      const saved = await saveReviewCategory(hooks.modules.reviews, scope, listing, review, category);
      if (generation.current === token) setListing(current => current ? withReviewCategory(current, saved) : current);
    } catch (cause) { if (generation.current === token) setCategoryError(cause instanceof Error ? cause.message : String(cause)); }
    finally { savingCategory.current = false; setCategorizing(null); }
  }
  return { connections, connectionId, repository, workspace, storage, queueFilter, setQueueFilter, categorizing, categoryError,
    scope, listing, opened, initializing, busy, error, service: hooks.modules.reviews,
    actions: { setConnectionId(value: string) { resetSource(); storage.clearConnection(); setConnectionId(value); }, setRepository(value: string) { resetSource(); storage.chooseRepository(value); }, setWorkspace(value: string) { resetSource(); storage.chooseWorkspace(value); }, load: () => selected && void load({ connectionId: selected.id, installationId: selected.installationId, repository, workspace }, true),
      refresh: () => scope && void load(scope), updateListing: setListing, categorize } };
}

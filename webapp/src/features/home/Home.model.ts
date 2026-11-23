import type { HomeState } from './Home.controller';
import { reviewStatus } from '../reviews/model';
export function homeRequests(state: HomeState) {
  return state.sources.flatMap(source => source.scope && source.listing ? source.listing.requests.map(review => ({ source, review,
    key: JSON.stringify([source.scope!.connectionId, source.scope!.installationId, source.scope!.repository.toLowerCase(), source.scope!.workspace, source.listing!.reviewer, review.request.request_id]),
    status: reviewStatus(review, source.listing!.artifacts, source.listing!.reviewer) })) : [])
    .sort((a, b) => (b.review.request.created_at ? Date.parse(b.review.request.created_at) : -Infinity) - (a.review.request.created_at ? Date.parse(a.review.request.created_at) : -Infinity)
      || a.review.request.title.localeCompare(b.review.request.title) || a.key.localeCompare(b.key));
}
export interface HomeModel {
  state: HomeState;
  connectionId: string;
  repository: string;
  waitingOnly: boolean;
  showDismissed: boolean;
  dismissed: ReadonlySet<string>;
  preferencesReady: boolean;
  preferencesError: string;
  actions: {
    setConnectionId(value: string): void;
    setRepository(value: string): void;
    setWaitingOnly(value: boolean): void;
    setShowDismissed(value: boolean): void;
    dismiss(key: string, value: boolean): void;
    reconnect(): void;
    retry(id: string): void;
    addRepository(): void;
  };
}

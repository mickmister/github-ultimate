import type { FeedbackComment } from './contracts';

export interface FeedbackAnnotationAdapter {
  set(comments: readonly FeedbackComment[], activeId: string | null, activate: (id: string) => void): void;
  top(comment: FeedbackComment): number | null;
  reveal(comment: FeedbackComment): void;
  subscribe(measure: () => void): () => void;
  clear(): void;
}
const adapters = new WeakMap<HTMLElement, FeedbackAnnotationAdapter>();
export function registerFeedbackAnnotations(host: HTMLElement, adapter: FeedbackAnnotationAdapter) {
  adapters.set(host, adapter);
  host.dataset.feedbackAnnotations = 'adapter';
  host.dispatchEvent(new CustomEvent('feedback-annotations-ready', { bubbles: true }));
  return () => { adapter.clear(); adapters.delete(host); delete host.dataset.feedbackAnnotations; };
}
export function feedbackAnnotationAdapter(root: HTMLElement) {
  for (const host of [root, ...root.querySelectorAll<HTMLElement>('[data-feedback-annotations]')]) {
    const adapter = adapters.get(host);
    if (adapter) return { host, adapter };
  }
  return null;
}

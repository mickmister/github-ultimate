import type { FeedbackCapture, FeedbackComment, FeedbackKind, FeedbackOptions } from './contracts';
import { formatFeedbackReview } from './review';

export const feedbackStorageKey = 'github-ultimate:feedback:v1';
export function restoreFeedbackDraft(value: string | null): FeedbackComment[] {
  try {
    const draft = JSON.parse(value ?? 'null');
    if (draft?.schemaVersion !== 1 || !Array.isArray(draft.interactions)) return [];
    return draft.interactions.filter((item: FeedbackComment) => {
      const context = item?.context, target = context?.target, selection = context?.selection;
      return typeof item.id === 'string' && Number.isSafeInteger(item.version) && item.version > 0 &&
        ['content-comment', 'feature-comment'].includes(item.kind) && typeof item.comment === 'string' &&
        (context?.pageUrl === undefined || typeof context.pageUrl === 'string') && typeof context?.appBuild === 'string' && typeof context.capturedAt === 'string' &&
        typeof target?.elementId === 'string' && typeof target.label === 'string' && typeof target.featureId === 'string' &&
        Array.isArray(target.uiPath) && target.uiPath.every(part => typeof part === 'string') &&
        (target.resource === undefined || typeof target.resource?.kind === 'string' && typeof target.resource.id === 'string') &&
        (selection === null || typeof selection?.text === 'string' && typeof selection.representation === 'string');
    });
  } catch { return []; }
}

export function createFeedbackQueue(initial: readonly FeedbackComment[] = [], persist: (value: string) => void = () => {}, options: FeedbackOptions = {}) {
  let includePageUrl = options.includePageUrl === true;
  function capture(context: FeedbackCapture): FeedbackCapture {
    if (includePageUrl) return context;
    const { pageUrl: _pageUrl, ...requiredContext } = context;
    return requiredContext;
  }
  const sanitize = (item: FeedbackComment) => ({ ...item, context: capture(item.context) });
  let state = { items: initial.map(sanitize), exporting: false, message: '' };
  const listeners = new Set<() => void>();
  function update(next: Partial<typeof state>, save = false) {
    state = { ...state, ...next };
    if (save) {
      try { persist(JSON.stringify({ schemaVersion: 1, interactions: state.items })); }
      catch { state = { ...state, message: 'The tab draft could not be saved. Keep this page open until you copy your comments.' }; }
    }
    listeners.forEach(listener => listener());
  }
  // Migrate old tab drafts immediately, rather than waiting for an edit/export.
  if (!includePageUrl && initial.some(item => item.context.pageUrl !== undefined)) update({}, true);
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setIncludePageUrl(include: boolean) {
      if (includePageUrl === include) return;
      includePageUrl = include;
      if (!include) update({ items: state.items.map(item => item.context.pageUrl === undefined ? item : { ...sanitize(item), version: item.version + 1 }) }, true);
    },
    add(kind: FeedbackKind, comment: string, context: FeedbackCapture) {
      if (!comment.trim()) return;
      const item: FeedbackComment = { id: crypto.randomUUID(), version: 1, kind, comment, context: structuredClone(capture(context)) };
      update({ items: [...state.items, item], message: 'Comment queued.' }, true);
    },
    edit(id: string, comment: string) {
      update({ items: state.items.map(item => item.id === id ? { ...item, comment, version: item.version + 1 } : item), message: '' }, true);
    },
    remove(id: string) { update({ items: state.items.filter(item => item.id !== id), message: '' }, true); },
    async copyAndClear(write: (text: string) => Promise<void>) {
      if (state.exporting || !state.items.length) return;
      const exported = [...state.items];
      const versions = new Map(exported.map(item => [item.id, item.version]));
      const review = formatFeedbackReview(exported);
      update({ exporting: true, message: '' });
      try {
        // Start clipboard writing directly in the user's click, before any other asynchronous work.
        await write(review);
        update({ items: state.items.filter(item => versions.get(item.id) !== item.version), exporting: false, message: 'Review copied. Exported comments cleared.' }, true);
      } catch {
        update({ exporting: false, message: 'Clipboard copy failed. Your comments are still queued; retry from the Copy review & clear button.' });
      }
    },
  };
}

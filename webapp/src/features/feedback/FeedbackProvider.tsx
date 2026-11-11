import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { FeedbackCapture, FeedbackComment, FeedbackKind, FeedbackOptions, FeedbackSelection, FeedbackTarget } from './contracts';
import { createFeedbackQueue, feedbackStorageKey, restoreFeedbackDraft } from './queue';
import { captureFeedbackSelection } from './selection';
import { FeedbackShellView } from './FeedbackShell.view';

interface FeedbackAPI {
  readonly items: readonly FeedbackComment[];
  edit(id: string, text: string): void;
  remove(id: string): void;
  open(target: FeedbackTarget, root: HTMLElement, origin: HTMLElement, point?: { x: number; y: number }, selection?: FeedbackSelection | null): void;
}
export const FeedbackContext = createContext<FeedbackAPI | null>(null);
export const AttachableParentContext = createContext<FeedbackTarget | null>(null);
export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('AttachableContext requires a FeedbackProvider.');
  return value;
}

/** Place once above the router/panels; nested consumers also work as standalone presentations. */
export function FeedbackProvider({ children, includePageUrl = false, storageKey = feedbackStorageKey }: FeedbackOptions & { children: ReactNode; storageKey?: string }) {
  const parent = useContext(FeedbackContext);
  return parent ? <>{children}</> : <FeedbackRoot key={storageKey} includePageUrl={includePageUrl} storageKey={storageKey}>{children}</FeedbackRoot>;
}

function FeedbackRoot({ children, includePageUrl, storageKey }: { children: ReactNode; includePageUrl: boolean; storageKey: string }) {
  const [queue] = useState(() => {
    let initial = null;
    try { initial = sessionStorage.getItem(storageKey); } catch { /* Memory-only draft until storage is available. */ }
    return createFeedbackQueue(restoreFeedbackDraft(initial), value => sessionStorage.setItem(storageKey, value), { includePageUrl });
  });
  useEffect(() => { queue.setIncludePageUrl(includePageUrl); }, [queue, includePageUrl]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [active, setActive] = useState<{ context: FeedbackCapture; point: { x: number; y: number } } | null>(null);
  const [composer, setComposer] = useState<{ kind: FeedbackKind; context: FeedbackCapture; text: string } | null>(null);
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState('');
  const origin = useRef<HTMLElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const api: FeedbackAPI = {
    items: state.items, edit: queue.edit, remove: queue.remove,
    open(target, root, trigger, point, selection) {
      const rect = trigger.getBoundingClientRect();
      const viewport = root.ownerDocument.defaultView!;
      origin.current = trigger;
      setNotice('');
      setActive({ point: point ?? { x: Math.max(8, Math.min(rect.left, viewport.innerWidth - 8)), y: Math.max(8, Math.min(rect.bottom, viewport.innerHeight - 8)) }, context: structuredClone({
        target, selection: selection === undefined ? captureFeedbackSelection(root, target.representation) : selection,
        ...(includePageUrl ? { pageUrl: root.ownerDocument.location.href } : {}),
        appBuild: import.meta.env.VITE_UI_BUILD ?? 'development', capturedAt: new Date().toISOString(),
      }) });
    },
  };
  function closeMenu() { setActive(null); origin.current?.focus(); }
  function select(value: string) {
    if (!active) return;
    const context = active.context;
    if (value === 'copy' && context.selection) {
      void navigator.clipboard?.writeText(context.selection.text).then(() => setNotice('Selection copied.'), () => setNotice('Clipboard copy failed. Select the text and use your browser’s Copy command.'));
      if (!navigator.clipboard) setNotice('Clipboard is unavailable. Select the text and use your browser’s Copy command.');
    } else if (value === 'feature-comment' || value === 'content-comment' && context.target.resource) {
      setComposer({ kind: value as FeedbackKind, context, text: '' });
    }
    closeMenu();
  }
  return <FeedbackContext.Provider value={api}>
    <FeedbackShellView active={active} composer={composer} review={review} state={state} notice={notice} commentRef={commentRef}
      actions={{
        closeMenu, select,
        openReview(element) { origin.current = element; setNotice(''); setReview(true); },
        closeDialog() { setComposer(null); setReview(false); origin.current?.focus(); },
        setComment(text) { setComposer(value => value ? { ...value, text } : null); },
        addComment() {
          if (!composer?.text.trim()) return;
          queue.add(composer.kind, composer.text, composer.context);
          setComposer(null); setNotice(''); origin.current?.focus();
        },
        edit: queue.edit, remove: queue.remove,
        copyAndClear() { setNotice(''); void queue.copyAndClear(text => navigator.clipboard.writeText(text)); },
      }}>{children}</FeedbackShellView>
  </FeedbackContext.Provider>;
}

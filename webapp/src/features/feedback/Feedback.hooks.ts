import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefCallback } from 'react';
import type { FeedbackCapture, FeedbackComment, FeedbackKind, FeedbackSelection, FeedbackTarget } from './contracts';
import { createFeedbackQueue, restoreFeedbackDraft } from './queue';
import { captureFeedbackSelection } from './selection';
import { feedbackCopy } from './Feedback.copy';
import { useTouchFeedbackSelection } from './useTouchFeedbackSelection';

interface FeedbackAPI {
  readonly items: readonly FeedbackComment[];
  setPortalContainer(container: HTMLElement | null): void;
  registerTarget(root: HTMLElement, target: FeedbackTarget): () => void;
  edit(id: string, text: string): void;
  remove(id: string): void;
  open(target: FeedbackTarget, root: HTMLElement, origin: HTMLElement, point?: { x: number; y: number }, selection?: FeedbackSelection | null): void;
}
export const FeedbackContext = createContext<FeedbackAPI | null>(null);
export const AttachableParentContext = createContext<FeedbackTarget | null>(null);
export function useParentFeedback() { return useContext(FeedbackContext); }
export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('AttachableContext requires a FeedbackProvider.');
  return value;
}

export function useFeedbackModel({ includePageUrl, storageKey, providedQueue, uiSuppressed = false }: { includePageUrl: boolean; storageKey: string; providedQueue?: ReturnType<typeof createFeedbackQueue>; uiSuppressed?: boolean }) {
  const [queue] = useState(() => {
    if (providedQueue) return providedQueue;
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
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLButtonElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const fields = useRef(new Map<string, RefCallback<HTMLTextAreaElement>>());
  function textareaRef(id: string) {
    let callback = fields.current.get(id);
    if (!callback) {
      let previous: HTMLTextAreaElement | null = null;
      let caret: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null = null;
      callback = node => {
        if (!node && previous && previous.ownerDocument.activeElement === previous) {
          caret = { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection };
        }
        previous = node;
        if (id === 'composer') commentRef.current = node;
        if (node && caret) {
          const saved = caret; caret = null;
          queueMicrotask(() => { if (node.isConnected) { node.focus(); node.setSelectionRange(saved.start, saved.end, saved.direction); } });
        }
      };
      fields.current.set(id, callback);
    }
    return callback;
  }
  const touch = useTouchFeedbackSelection(!uiSuppressed && !active && !composer && !review);
  const api: FeedbackAPI = {
    items: state.items, edit: queue.edit, remove: queue.remove, setPortalContainer, registerTarget: touch.registerTarget,
    open(target, root, trigger, point, selection) {
      if (uiSuppressed) return;
      touch.dismiss();
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
  function returnFocusEl() { return origin.current?.isConnected ? origin.current : dockRef.current; }
  function restoreFocus() { returnFocusEl()?.focus(); }
  function closeMenu() { setActive(null); restoreFocus(); }
  function select(value: string) {
    if (!active) return;
    const context = active.context;
    if (value === 'copy' && context.selection) {
      try {
        if (!navigator.clipboard) setNotice(feedbackCopy.clipboardUnavailable.text);
        else void navigator.clipboard.writeText(context.selection.text).then(() => setNotice(feedbackCopy.selectionCopied.text), () => setNotice(feedbackCopy.clipboardFailed.text));
      } catch { setNotice(feedbackCopy.clipboardFailed.text); }
    } else if (value === 'feature-comment' || value === 'content-comment' && context.target.resource) {
      setComposer({ kind: value as FeedbackKind, context, text: '' });
    }
    closeMenu();
  }
  return { api, active, composer, review, state, notice, commentRef, dockRef, textareaRef, returnFocusEl, portalContainer, selectionPoint: touch.selected?.point ?? null,
      actions: {
        closeMenu, select,
        openSelection() {
          const selected = touch.capture();
          if (selected) api.open(selected.target, selected.root, selected.root, selected.point, selected.selection);
          else touch.dismiss();
        },
        openReview(element: HTMLElement) { origin.current = element; setNotice(''); setReview(true); },
        closeDialog() { setComposer(null); setReview(false); restoreFocus(); },
        setComment(text: string) { setComposer(value => value ? { ...value, text } : null); },
        addComment() {
          if (!composer?.text.trim()) return;
          queue.add(composer.kind, composer.text, composer.context);
          setComposer(null); setNotice(''); restoreFocus();
        },
        edit: queue.edit, remove: queue.remove,
        copyAndClear(kind: FeedbackKind) { setNotice(''); void queue.copyAndClear(text => navigator.clipboard.writeText(text), kind); },
      } };
}

export type FeedbackModel = ReturnType<typeof useFeedbackModel>;

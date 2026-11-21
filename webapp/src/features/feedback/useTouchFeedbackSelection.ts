import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackSelection, FeedbackTarget } from './contracts';
import { captureFeedbackSelection } from './selection';

interface TouchSelection {
  root: HTMLElement; target: FeedbackTarget; selection: FeedbackSelection;
  point: { x: number; y: number };
}
const identity = (target: FeedbackTarget) => JSON.stringify([target.elementId, target.representation, target.resource]);

/** Offer touch actions without opening a focus-stealing menu during native handle dragging. */
export function useTouchFeedbackSelection(enabled: boolean) {
  const targets = useRef(new Map<HTMLElement, FeedbackTarget>());
  const [selected, setSelected] = useState<TouchSelection | null>(null);
  const registerTarget = useCallback((root: HTMLElement, target: FeedbackTarget) => {
    targets.current.set(root, target);
    return () => { if (targets.current.get(root) === target) targets.current.delete(root); };
  }, []);
  useEffect(() => {
    if (!enabled) { setSelected(null); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointer: string | null = null, dragging = false;
    function refresh() {
      if (dragging || pointer === 'mouse' || !pointer && !window.matchMedia('(pointer: coarse)').matches) return;
      const active = document.activeElement;
      const input = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.selectionStart != null && active.selectionEnd != null && active.selectionEnd > active.selectionStart ? active : null;
      const native = document.getSelection();
      const range = native?.rangeCount && !native.isCollapsed ? native.getRangeAt(0) : null;
      const start = input ?? (range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range?.startContainer.parentElement);
      const end = input ?? (range?.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range?.endContainer.parentElement);
      const root = start?.closest<HTMLElement>('[data-feedback-target]');
      const target = root && targets.current.get(root);
      if (!root || !root.isConnected || !target || end?.closest('[data-feedback-target]') !== root || start?.closest('[data-feedback-control]')) { setSelected(null); return; }
      const selection = captureFeedbackSelection(root, target.representation);
      if (!selection) { setSelected(null); return; }
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight);
      const rects = input ? [input.getBoundingClientRect()] : range ? Array.from(range.getClientRects()) : [];
      const rect = rects.filter(rect => rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right).at(-1);
      if (!rect) { setSelected(null); return; }
      const x = Math.max(left + 8, Math.min(rect.left, right - 188));
      const y = Math.max(top + 8, Math.min(rect.bottom + 8 <= bottom - 52 ? rect.bottom + 8 : rect.top - 52, bottom - 52));
      setSelected({ root, target, selection, point: { x, y } });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 180); }
    function down(event: PointerEvent) {
      if ((event.target as Element).closest?.('[data-feedback-control]')) return;
      pointer = event.pointerType;
      dragging = pointer === 'touch' || pointer === 'pen';
      setSelected(null);
    }
    function up() { dragging = false; schedule(); }
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('select', schedule, true);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('select', schedule, true);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [enabled]);
  return {
    selected, registerTarget,
    dismiss: () => setSelected(null),
    capture() {
      if (!selected?.root.isConnected) return null;
      const current = targets.current.get(selected.root);
      return current && identity(current) === identity(selected.target) ? selected : null;
    },
  };
}

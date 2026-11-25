import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeedbackComment, FeedbackTarget } from './contracts';
import { useFeedback } from './FeedbackProvider';
import { renderedFeedbackRange, sameFeedbackResource } from './anchors';
import { feedbackAnnotationAdapter } from './annotation-adapter';
import { FeedbackAnnotationsView } from './FeedbackAnnotations.view';

export interface AnnotationPosition {
  id: string; top: number; markerTop: number; status: string;
  rects: { left: number; top: number; width: number; height: number }[];
}

export function FeedbackAnnotations({ target, children, showRepresentation }: {
  target: FeedbackTarget; children: ReactNode; showRepresentation?: (representation: string) => void;
}) {
  const feedback = useFeedback();
  const resource = target.resource;
  const comments = useMemo(() => feedback.items.filter(item => sameFeedbackResource(item.context.target.resource, resource)),
    [feedback.items, resource?.kind, resource?.id, resource?.repository, resource?.workspace, resource?.path, resource?.revision]);
  const content = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const ranges = useRef(new Map<string, Range>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [layout, setLayout] = useState<{ positions: AnnotationPosition[]; height: number }>({ positions: [], height: 0 });
  const id = useId();
  const activate = (commentId: string, focus = false) => {
    setActiveId(commentId);
    if (focus) cards.current.get(commentId)?.focus({ preventScroll: true });
  };
  const activateRef = useRef(activate); activateRef.current = activate;
  useEffect(() => {
    const root = content.current, container = body.current;
    if (!root || !container) return;
    let frame = 0, stopped = false;
    let attached: ReturnType<typeof feedbackAnnotationAdapter> = null;
    let unsubscribe = () => {};
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    function measure() {
      if (stopped) return;
      const bounds = container!.getBoundingClientRect();
      ranges.current.clear();
      const positions = comments.map(item => {
        const selection = item.context.selection;
        let top: number | null = null;
        let rects: AnnotationPosition['rects'] = [];
        let status = selection ? 'Passage could not be matched in this view.' : 'Whole document — no selected passage.';
        if (selection && selection.representation !== target.representation) status = `Selected in ${selection.representation === 'source' ? 'source' : selection.representation === 'rendered-markdown' ? 'Markdown' : 'another'} view.`;
        else if (selection && target.representation === 'source') {
          const localTop = attached?.adapter.top(item);
          if (localTop != null) { top = localTop + attached!.host.getBoundingClientRect().top - bounds.top; status = ''; }
        } else if (selection) {
          const range = renderedFeedbackRange(root!, selection);
          if (range) {
            ranges.current.set(item.id, range);
            rects = [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => ({
              left: Math.max(0, rect.left - bounds.left), top: rect.top - bounds.top,
              width: Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)), height: rect.height,
            })).filter(rect => rect.width > 0);
            if (rects.length) { top = rects[0].top; status = ''; }
          }
        }
        return { id: item.id, top: top ?? Infinity, markerTop: top ?? 0, status, rects };
      }).sort((a, b) => a.top - b.top);
      let bottom = 42, markerBottom = 0;
      for (const position of positions) {
        position.markerTop = Math.max(markerBottom, position.markerTop);
        if (!position.status) markerBottom = position.markerTop + 48;
        position.top = Math.max(bottom, Number.isFinite(position.top) ? position.top : bottom);
        bottom = position.top + (cards.current.get(position.id)?.getBoundingClientRect().height ?? 190) + 12;
      }
      const next = { positions, height: comments.length ? bottom : 0 };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    function attach() {
      const found = feedbackAnnotationAdapter(root!);
      if (found?.adapter !== attached?.adapter) { unsubscribe(); attached?.adapter.clear(); attached = found; unsubscribe = attached?.adapter.subscribe(schedule) ?? (() => {}); }
      attached?.adapter.set(comments.filter(item => item.context.selection?.representation === target.representation), activeId, commentId => activateRef.current(commentId, true));
      schedule();
    }
    const resize = new ResizeObserver(schedule);
    resize.observe(root); resize.observe(container);
    for (const card of cards.current.values()) resize.observe(card);
    const mutation = new MutationObserver(schedule);
    mutation.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener('feedback-annotations-ready', attach);
    root.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    void root.ownerDocument.fonts?.ready.then(() => { if (!stopped) schedule(); });
    attach();
    return () => { stopped = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); unsubscribe(); attached?.adapter.clear(); ranges.current.clear(); root.removeEventListener('feedback-annotations-ready', attach); root.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [comments, target.representation, activeId]);

  function reveal(item: FeedbackComment) {
    activate(item.id);
    if (item.context.selection?.representation !== target.representation) { if (item.context.selection) showRepresentation?.(item.context.selection.representation); return; }
    const adapter = content.current && feedbackAnnotationAdapter(content.current);
    if (adapter) adapter.adapter.reveal(item);
    else {
      const node = ranges.current.get(item.id)?.startContainer;
      (node instanceof Element ? node : node?.parentElement)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
  return <FeedbackAnnotationsView id={id} comments={comments} allItems={feedback.items} layout={layout} activeId={activeId}
    contentRef={content} bodyRef={body} canChangeRepresentation={Boolean(showRepresentation)} representation={target.representation}
    actions={{
      cardRef(commentId, element) { if (element) cards.current.set(commentId, element); else cards.current.delete(commentId); },
      activate, reveal, edit: feedback.edit,
      remove(commentId) {
        const index = comments.findIndex(item => item.id === commentId);
        const next = comments[index + 1] ?? comments[index - 1];
        if (next) activate(next.id, true); else body.current?.focus({ preventScroll: true });
        feedback.remove(commentId);
      },
      clickText(event) {
        if (!content.current?.ownerDocument.getSelection()?.isCollapsed) return;
        for (const [commentId, range] of ranges.current) if ([...range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) { activate(commentId, true); break; }
      },
    }}>{children}</FeedbackAnnotationsView>;
}

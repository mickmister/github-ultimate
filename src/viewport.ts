// The layout viewport does not necessarily shrink with Safari's keyboard.
// Expose visible geometry without changing GitHub's viewport or zoom behavior.
export function trackViewport(host: HTMLElement): void {
  const viewport = window.visualViewport;
  const update = () => {
    host.style.setProperty('--gu-viewport-height', `${viewport?.height ?? innerHeight}px`);
    host.style.setProperty('--gu-viewport-width', `${viewport?.width ?? innerWidth}px`);
    host.style.setProperty('--gu-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    host.style.setProperty('--gu-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    const active = document.activeElement?.shadowRoot?.activeElement ?? document.activeElement;
    host.toggleAttribute('data-gu-editing', active instanceof HTMLElement && active.matches('textarea, input:not([type=checkbox]):not([type=button]), [contenteditable=true]'));
  };
  // Focus moves between controls in the same shadow root are not retargeted
  // to document. Defer blur until the replacement activeElement is installed.
  const onFocus = () => queueMicrotask(update);
  const onShadowFocus = () => queueMicrotask(() => window.dispatchEvent(new Event('gu-focus-change')));
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('gu-focus-change', update);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  host.shadowRoot?.addEventListener('focusin', onShadowFocus);
  host.shadowRoot?.addEventListener('focusout', onShadowFocus);
  update();
  host.addEventListener('gu-dispose', () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    window.removeEventListener('gu-focus-change', update);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
    host.shadowRoot?.removeEventListener('focusin', onShadowFocus);
    host.shadowRoot?.removeEventListener('focusout', onShadowFocus);
  }, { once: true });
}

/** Keep the modal shell stable; only its inner scroll window follows the keyboard. */
export function stabilizeZen(dialog: HTMLDialogElement): () => void {
  const viewport = window.visualViewport;
  const header = dialog.querySelector<HTMLElement>('.zen-header')!;
  const body = dialog.querySelector<HTMLElement>('.zen-body')!;
  let layoutWidth = 0, top = 0, height = 0, frame = 0;
  const revealFocus = () => {
    const active = (dialog.getRootNode() as ShadowRoot).activeElement;
    if (!(active instanceof HTMLElement) || !body.contains(active)) return;
    const bounds = body.getBoundingClientRect(), field = active.getBoundingClientRect();
    if (field.top < bounds.top || field.height > bounds.height) body.scrollTop += field.top - bounds.top - 12;
    else if (field.bottom > bounds.bottom) body.scrollTop += field.bottom - bounds.bottom + 12;
  };
  const update = () => {
    // A real orientation/layout-width change may resize the shell. Keyboard and
    // toolbar visualViewport height changes do not repeatedly recenter it.
    if (innerWidth !== layoutWidth) {
      layoutWidth = innerWidth;
      const gap = innerWidth <= 600 ? 12 : 32;
      top = gap / 2; height = Math.max(0, innerHeight - gap);
      const width = Math.min(900, innerWidth - gap);
      dialog.style.setProperty('--gu-zen-height', `${height}px`);
      dialog.style.setProperty('--gu-zen-width', `${width}px`);
      dialog.style.setProperty('--gu-zen-top', `${top}px`);
      dialog.style.setProperty('--gu-zen-left', `${(innerWidth - width) / 2}px`);
    }
    const visibleTop = viewport?.offsetTop ?? 0;
    const visibleBottom = visibleTop + (viewport?.height ?? innerHeight);
    const offset = Math.max(0, visibleTop - top);
    const headerHeight = header.getBoundingClientRect().height;
    dialog.style.setProperty('--gu-zen-content-offset', `${offset}px`);
    dialog.style.setProperty('--gu-zen-body-height', `${Math.max(0, Math.min(height - offset, visibleBottom - top - offset) - headerHeight - 2)}px`);
    cancelAnimationFrame(frame); frame = requestAnimationFrame(revealFocus);
  };
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  dialog.addEventListener('focusin', update);
  update();
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    dialog.removeEventListener('focusin', update);
  };
}

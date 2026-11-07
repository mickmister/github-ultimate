// The layout viewport does not necessarily shrink with Safari's keyboard.
// Size extension overlays against the visible viewport, without changing GitHub.
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

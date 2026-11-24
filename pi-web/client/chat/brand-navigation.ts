/** Same navigation-only custom scheme as the hosted Open in Alohak handoff. */
export function brandDestination(href: string, userAgent: string, maxTouchPoints: number, native: boolean) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(userAgent) || /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  if (native || /Alohak\/1/.test(userAgent) || !mobile) return new URL('../app/', href).href;
  const target = new URL(href), link = new URL('alohak://open');
  link.searchParams.set('route', target.pathname + target.search + target.hash);
  return link.href;
}

export type Surface = 'phone' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';
export interface Presentation { surface: Surface; orientation: Orientation }
export const surfaces = ['phone', 'tablet', 'desktop'] as const;
export const orientations = ['portrait', 'landscape'] as const;

// Available application space, not device identity. Keep a landscape phone in
// the phone surface; support tall desktop windows and tablet split-screen.
export function classifyPresentation(width: number, height: number): Presentation {
  const short = Math.min(width, height), long = Math.max(width, height);
  return { surface: short < 600 ? 'phone' : long <= 1366 ? 'tablet' : 'desktop', orientation: width >= height ? 'landscape' : 'portrait' };
}

export function nextGeometry(previous: { width: number; height: number }, next: { width: number; height: number }, editing: boolean) {
  // Height-only keyboard resizes must not swap the active view while typing.
  return editing && previous.width === next.width ? previous : next;
}

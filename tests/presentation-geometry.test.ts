import { describe, expect, it } from 'vitest';
import { classifyPresentation, nextGeometry } from '../webapp/src/presentation/geometry';
describe('surface geometry', () => {
  it.each([
    [390, 844, 'phone', 'portrait'], [844, 390, 'phone', 'landscape'],
    [820, 1180, 'tablet', 'portrait'], [1180, 820, 'tablet', 'landscape'],
    [900, 1440, 'desktop', 'portrait'], [1440, 900, 'desktop', 'landscape'],
  ])('%i × %i selects %s %s', (width, height, surface, orientation) => {
    expect(classifyPresentation(Number(width), Number(height))).toEqual({ surface, orientation });
  });
  it('holds height-only keyboard geometry during editing but allows rotation and later recovery', () => {
    const initial = { width: 820, height: 1180 }, keyboard = { width: 820, height: 500 };
    expect(nextGeometry(initial, keyboard, true)).toBe(initial);
    expect(nextGeometry(initial, keyboard, false)).toBe(keyboard);
    expect(nextGeometry(initial, { width: 1180, height: 820 }, true)).toEqual({ width: 1180, height: 820 });
  });
});

export const shellColorNames = ['background', 'surface', 'text', 'muted', 'border', 'accent', 'selected', 'error'] as const;
export type ShellTheme = Record<typeof shellColorNames[number], string>;
export const shellPalettes: Record<'light' | 'dark', ShellTheme> = {
  light: { background: '#f5f7fb', surface: '#ffffff', text: '#19283d', muted: '#53647b', border: '#d6deeb', accent: '#4e38bd', selected: '#f0edff', error: '#a01d32' },
  dark: { background: '#101724', surface: '#182233', text: '#e4ebf6', muted: '#aabbd1', border: '#35445c', accent: '#bdadff', selected: '#302a4e', error: '#ffabb9' },
};
export function parseShellTheme(input: unknown): ShellTheme {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected shell colors.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== shellColorNames.length || !shellColorNames.every(key => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key] as string))) throw new Error('Expected eight opaque RGB shell colors.');
  return Object.fromEntries(shellColorNames.map(key => [key, value[key]])) as ShellTheme;
}
export function darkShell(theme: ShellTheme) {
  const rgb = [1, 3, 5].map(offset => parseInt(theme.background.slice(offset, offset + 2), 16) / 255);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < .5;
}

import type { tokenNames } from '../../../../src/ui-customization';

export type ThemeToken = typeof tokenNames[number];
export interface ThemeSetting { token: ThemeToken; label: string; placeholder: string; color?: boolean }
export const settingGroups: { title: string; fields: ThemeSetting[] }[] = [
  { title: 'Colors', fields: [
    { token: 'background', label: 'Background color', placeholder: 'App default', color: true },
    { token: 'surface', label: 'Surface color', placeholder: 'App default', color: true },
    { token: 'text', label: 'Text color', placeholder: 'App default', color: true },
    { token: 'muted', label: 'Muted text color', placeholder: 'App default', color: true },
    { token: 'border', label: 'Border color', placeholder: 'App default', color: true },
    { token: 'accent', label: 'Accent color', placeholder: 'App default', color: true },
    { token: 'selected', label: 'Selected background color', placeholder: 'App default', color: true },
    { token: 'error', label: 'Error color', placeholder: 'App default', color: true },
  ] },
  { title: 'Typography', fields: [
    { token: 'fontFamily', label: 'Font family', placeholder: 'system-ui, sans-serif' },
    { token: 'fontSize', label: 'Font size', placeholder: '16px' },
    { token: 'lineHeight', label: 'Line height', placeholder: '1.6' },
  ] },
  { title: 'Spacing and shape', fields: [
    { token: 'radius', label: 'Corner radius', placeholder: '8px' },
    { token: 'spacing', label: 'Spacing', placeholder: 'App default' },
    { token: 'controlSize', label: 'Minimum control height', placeholder: '44px' },
  ] },
  { title: 'Layout', fields: [
    { token: 'contentWidth', label: 'Content width', placeholder: '1500px' },
    { token: 'sidebarWidth', label: 'Sidebar width', placeholder: 'App default' },
  ] },
];
export function hexColor(value: string | undefined) {
  if (/^#[a-f\d]{6}$/i.test(value ?? '')) return value;
  if (/^#[a-f\d]{3}$/i.test(value ?? '')) return '#' + value!.slice(1).split('').map(character => character + character).join('');
  return undefined;
}

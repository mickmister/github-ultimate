import type { tokenNames } from '../../../../src/ui-customization';
import { copy } from './Customization.copy';

export type ThemeToken = typeof tokenNames[number];
export interface ThemeSetting { token: ThemeToken; label: string; placeholder: string; color?: boolean }
export const settingGroups: { title: string; fields: ThemeSetting[] }[] = [
  { title: copy.colors, fields: [
    { token: 'background', label: copy.background, placeholder: copy.appDefault, color: true },
    { token: 'surface', label: copy.surface, placeholder: copy.appDefault, color: true },
    { token: 'text', label: copy.textColor, placeholder: copy.appDefault, color: true },
    { token: 'muted', label: copy.muted, placeholder: copy.appDefault, color: true },
    { token: 'border', label: copy.border, placeholder: copy.appDefault, color: true },
    { token: 'accent', label: copy.accent, placeholder: copy.appDefault, color: true },
    { token: 'selected', label: copy.selected, placeholder: copy.appDefault, color: true },
    { token: 'error', label: copy.errorColor, placeholder: copy.appDefault, color: true },
  ] },
  { title: copy.typography, fields: [
    { token: 'fontFamily', label: copy.fontFamily, placeholder: 'system-ui, sans-serif' },
    { token: 'fontSize', label: copy.fontSize, placeholder: '16px' },
    { token: 'lineHeight', label: copy.lineHeight, placeholder: '1.6' },
  ] },
  { title: copy.shape, fields: [
    { token: 'radius', label: copy.radius, placeholder: '8px' },
    { token: 'spacing', label: copy.spacing, placeholder: copy.appDefault },
    { token: 'controlSize', label: copy.controlSize, placeholder: '44px' },
  ] },
  { title: copy.layout, fields: [
    { token: 'contentWidth', label: copy.contentWidth, placeholder: '1500px' },
    { token: 'sidebarWidth', label: copy.sidebarWidth, placeholder: copy.appDefault },
  ] },
];
export function hexColor(value: string | undefined) {
  if (/^#[a-f\d]{6}$/i.test(value ?? '')) return value;
  if (/^#[a-f\d]{3}$/i.test(value ?? '')) return '#' + value!.slice(1).split('').map(character => character + character).join('');
  return undefined;
}

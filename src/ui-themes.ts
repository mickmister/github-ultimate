import { defaultCustomization, type Customization } from './ui-customization';

const theme = (name: string, mode: Customization['mode'], tokens: Customization['tokens']): Customization => ({ ...defaultCustomization(), name, mode, tokens });
export const builtInThemes = [
  { id: 'system', description: 'Follow your device appearance and app defaults.', value: defaultCustomization() },
  { id: 'daylight', description: 'A clean light palette with violet accents.', value: theme('Daylight', 'light', { background: '#f5f7fb', surface: '#ffffff', text: '#19283d', muted: '#53647b', border: '#d6deeb', accent: '#4e38bd', selected: '#f0edff', error: '#a01d32' }) },
  { id: 'midnight', description: 'Deep blue surfaces and soft lavender accents.', value: theme('Midnight', 'dark', { background: '#101724', surface: '#182233', text: '#e4ebf6', muted: '#aabbd1', border: '#35445c', accent: '#bdadff', selected: '#302a4e', error: '#ffabb9' }) },
  { id: 'forest', description: 'A dark green palette with mint accents.', value: theme('Forest', 'dark', { background: '#10201b', surface: '#193128', text: '#e5f3eb', muted: '#abc8b8', border: '#3d6050', accent: '#88d9ae', selected: '#254d3a', error: '#ffb5b5', radius: '6px' }) },
  { id: 'paper', description: 'Warm paper tones, serif typography, and square edges.', value: theme('Paper', 'light', { background: '#f5f0e6', surface: '#fffaf0', text: '#342c24', muted: '#716354', border: '#cec1aa', accent: '#85501d', selected: '#efe0c2', error: '#a12832', fontFamily: 'Georgia, serif', radius: '2px', lineHeight: '1.7' }) },
] as const;

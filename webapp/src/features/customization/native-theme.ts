import { shellColorNames, type ShellTheme } from '../../../../src/mobile-theme';

// Resolve CSS in the page, including named colors, variables and custom CSS.
// Only concrete RGB colors cross the bridge; native never interprets CSS.
export function syncNativeTheme() {
  if (!window.alohakNative) return;
  const variables = ['--bg', '--panel', '--fg', '--muted', '--line', '--accent', '--selected', '--error'];
  const probe = document.createElement('span'), canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  probe.style.display = 'none'; document.body.append(probe);
  try {
    const theme = {} as ShellTheme;
    shellColorNames.forEach((key, index) => {
      probe.style.color = `var(${variables[index]})`;
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).color; context.fillRect(0, 0, 1, 1);
      theme[key] = '#' + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('');
    });
    window.alohakNative.postMessage(JSON.stringify({ jsonrpc: '2.0', id: 'theme_' + crypto.randomUUID(), method: 'theme.set', params: theme }));
  } finally { probe.remove(); }
}

import { el, button, shadow, renderForm, renderSnapshot, renderResponse, copyText } from '../src/ui';
import { parseRecord, revisionOf } from '../src/protocol';
import { stories, extractRecord } from './stories';
import './playground.css';

type State = { story: string; source: string; css: string; theme: string; width: string; accent: string; surface: string };
const defaultCss = `/* These overrides run inside the extension's real Shadow DOM.\n   Try changing card spacing, typography or choice styling. */\n.form-card, .snapshot {\n  /* border-radius: 20px; */\n}\n.choice {\n  /* padding: 18px; */\n}\n`;
const initial: State = { story: 'decision', source: stories[0].source, css: defaultCss, theme: 'light', width: 'full', accent: '', surface: '' };
let state = { ...initial };
try {
  const saved = JSON.parse(localStorage.getItem('github-ultimate-playground') ?? 'null');
  if (saved && typeof saved.source === 'string' && typeof saved.css === 'string') state = { ...initial, ...saved };
  if (location.hash.startsWith('#state=')) {
    const shared = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(location.hash.slice(7)), c => c.charCodeAt(0))));
    if (shared && typeof shared.source === 'string' && typeof shared.css === 'string') state = { ...initial, ...shared };
  }
} catch { /* Broken local/share state must not prevent opening the playground. */ }
let host: HTMLElement | undefined, root: ShadowRoot | undefined, revision = 0;
const app = document.getElementById('app')!;
const sidebar = el('aside', undefined, 'sidebar');
sidebar.append(el('div', '✦', 'brand-icon'), el('h1', 'GitHub Ultimate'), el('p', 'Renderer playground', 'eyebrow'));
const storyNav = el('nav'); storyNav.setAttribute('aria-label', 'Examples');
sidebar.append(storyNav);
const asideNote = el('p', 'The same parser, renderer and styles that ship in the Chrome extension. No extension installation needed.', 'sidebar-note'); sidebar.append(asideNote);
const main = el('main'); const header = el('header', undefined, 'page-header');
const heading = el('div'); heading.append(el('p', 'Design / inspect / iterate', 'eyebrow'), el('h2', 'Make the workspace feel like yours.'));
const shareStatus = el('span', '', 'status'); shareStatus.setAttribute('role', 'status');
header.append(heading, button('Copy share link', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (bytes.length > 200000) { shareStatus.textContent = 'This example is too large for a share link. Use Export source / CSS instead.'; return; }
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  void copyText(`${location.origin}${location.pathname}#state=${encoded}`).then(() => { shareStatus.textContent = 'Link copied with your source and styles.'; }).catch(() => { shareStatus.textContent = 'Clipboard unavailable. Use Export source / CSS instead.'; });
}));
main.append(header, shareStatus);
const toolbar = el('section', undefined, 'toolbar');
function select(label: string, values: [string, string][], current: string, onChange: (value: string) => void) {
  const wrap = el('label', label); const input = el('select'); input.setAttribute('aria-label', label);
  for (const [value, title] of values) { const option = el('option', title); option.value = value; input.append(option); }
  input.value = current; input.addEventListener('change', () => onChange(input.value)); wrap.append(input); return wrap;
}
toolbar.append(select('Theme', [['light', 'GitHub light'], ['dark', 'Warm dark']], state.theme, value => { state.theme = value; applyStyles(); save(); }), select('Canvas width', [['full', 'Fluid'], ['840', 'Desktop · 840px'], ['480', 'Sidebar · 480px'], ['390', 'Phone · 390px']], state.width, value => { state.width = value; applyStyles(); save(); }));
function color(label: string, property: 'accent' | 'surface', fallback: string) {
  const wrap = el('label', label); const input = el('input'); input.type = 'color'; input.value = state[property] || fallback; input.setAttribute('aria-label', label);
  input.dataset.token = property;
  input.addEventListener('input', () => { state[property] = input.value; applyStyles(); save(); }); wrap.append(input); return wrap;
}
toolbar.append(color('Accent', 'accent', '#6e40c9'), color('Card background', 'surface', '#ffffff'), button('Reset colors', () => { state.accent = ''; state.surface = ''; applyStyles(); save(); })); main.append(toolbar);
const split = el('div', undefined, 'split'); const editors = el('section', undefined, 'editors');
const sourceLabel = el('label', 'Form / snapshot source', 'editor-label'); const sourceInput = el('textarea'); sourceInput.id = 'source'; sourceInput.value = state.source; sourceInput.spellcheck = false; sourceInput.setAttribute('aria-label', 'Frontmatter source'); sourceLabel.append(sourceInput);
const controls = el('div', undefined, 'editor-actions');
controls.append(button('Render source', () => { state.source = sourceInput.value; save(); void render(); }, 'primary'), button('Reset example', () => { loadStory(state.story); }), button('Export source', () => download('github-ultimate-record.txt', sourceInput.value)));
const error = el('pre', '', 'parse-error'); error.setAttribute('role', 'alert'); error.hidden = true;
const cssLabel = el('label', 'Live CSS overrides', 'editor-label'); const cssInput = el('textarea'); cssInput.id = 'css'; cssInput.value = state.css; cssInput.spellcheck = false; cssInput.setAttribute('aria-label', 'CSS overrides'); cssLabel.append(cssInput);
cssInput.addEventListener('input', () => { state.css = cssInput.value; applyStyles(); save(); });
const cssActions = el('div', undefined, 'editor-actions'); cssActions.append(button('Export CSS', () => download('github-ultimate-custom.css', customCss())), button('Reset CSS', () => { state.css = defaultCss; cssInput.value = state.css; applyStyles(); save(); }));
editors.append(sourceLabel, controls, error, cssLabel, cssActions, el('p', 'CSS changes apply immediately without clearing your answers. Source changes use Render source so typing does not reset the form. Exported overrides can be added to src/workspace.css.', 'hint'));
const preview = el('section', undefined, 'preview-pane'); const previewHeader = el('div', undefined, 'canvas-header');
const renderStatus = el('span', 'Ready', 'status'); renderStatus.setAttribute('role', 'status'); previewHeader.append(el('strong', 'Live extension renderer'), renderStatus);
const canvas = el('div', undefined, 'canvas'); preview.append(previewHeader, canvas);
const composer = el('section', undefined, 'composer'); composer.append(el('h3', 'Local GitHub comment editor'), el('p', 'Use a form action, review the generated command, then choose “Place in GitHub comment editor”. It lands here, never on GitHub.', 'hint'));
const comment = el('textarea'); comment.id = 'new_comment_field'; comment.name = 'comment[body]'; comment.rows = 9; comment.setAttribute('aria-label', 'Local GitHub comment editor');
composer.append(comment, button('Clear local comment', () => { comment.value = ''; })); preview.append(composer); split.append(editors, preview); main.append(split); app.append(sidebar, main);
function save() { try { localStorage.setItem('github-ultimate-playground', JSON.stringify(state)); } catch { shareStatus.textContent = 'Local storage unavailable; export your changes before leaving.'; } }
function customCss() { return `:host([data-theme]) {${state.accent ? ` --accent: ${state.accent};` : ''}${state.surface ? ` --bg: ${state.surface};` : ''} }\n${state.css}`; }
function applyStyles() {
  document.documentElement.dataset.theme = state.theme;
  for (const input of toolbar.querySelectorAll<HTMLInputElement>('input[data-token]')) {
    const property = input.dataset.token as 'accent' | 'surface';
    input.value = state[property] || (property === 'accent' ? state.theme === 'dark' ? '#ffc2a8' : '#6e40c9' : state.theme === 'dark' ? '#17121b' : '#ffffff');
  }
  canvas.style.maxWidth = state.width === 'full' ? '100%' : `${state.width}px`;
  if (host) host.dataset.theme = state.theme;
  if (root) {
    let style = root.querySelector<HTMLStyleElement>('#playground-overrides');
    if (!style) { style = el('style'); style.id = 'playground-overrides'; root.append(style); }
    style.textContent = customCss();
  }
}
async function render() {
  const current = ++revision;
  host?.dispatchEvent(new Event('gu-dispose')); canvas.replaceChildren();
  host = el('div'); host.id = 'renderer'; canvas.append(host); root = shadow(host); applyStyles();
  error.hidden = true;
  try {
    const raw = extractRecord(sourceInput.value); const data = parseRecord(raw);
    const hash = await revisionOf(raw); if (current !== revision) return;
    if ('format' in data) {
      const controller = renderForm(root!, data, { repository: 'mickmister/github-ultimate', number: 1, comment_id: 'playground-comment', revision: hash }, () => current === revision, false);
      if (state.story === 'submitted') controller.setResponses([{ record: { schema_version: 1, kind: 'response', response_id: 'playground-submitted', task_id: data.task_id ?? data.id, form_id: data.id, session_id: data.session_id ?? null, parent_task_id: null, source: { repository: 'mickmister/github-ultimate', number: 1, comment_id: 'playground-comment', revision: hash }, intent: 'discussion', resume_session: Boolean(data.session_id), allow_code_file_changes: false, answers: { scope: { unit: true, all: false }, additional_notes: 'Please explain the failure before implementing.' } } }]);
    }
    else if (data.kind === 'workflow') root!.append(renderSnapshot(data, 'mickmister/github-ultimate'));
    else root!.append(renderResponse(data));
    // Overrides come last in the shadow cascade, including after theme defaults.
    root!.append(root!.querySelector('#playground-overrides')!);
    renderStatus.textContent = 'Rendered · shipping UI';
  } catch (e) {
    error.textContent = (e as Error).message; error.hidden = false;
    root!.append(el('p', 'This record did not pass validation. Edit the source and render again.', 'notice'));
    renderStatus.textContent = 'Invalid record';
  }
}
function loadStory(id: string) {
  const story = stories.find(story => story.id === id) ?? stories[0];
  state.story = story.id; state.source = story.source; sourceInput.value = state.source;
  for (const node of storyNav.querySelectorAll<HTMLElement>('[data-story]')) node.setAttribute('aria-current', String(node.dataset.story === state.story));
  save(); void render();
}
for (const story of stories) {
  const item = button('', () => loadStory(story.id), 'story'); item.dataset.story = story.id; item.setAttribute('aria-current', String(story.id === state.story));
  item.append(el('strong', story.title), el('small', story.caption)); storyNav.append(item);
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
sourceInput.addEventListener('input', () => { state.source = sourceInput.value; save(); renderStatus.textContent = 'Source changed · click Render source'; });
applyStyles(); void render();

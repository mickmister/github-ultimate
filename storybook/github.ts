import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { el, button, shadow } from '../src/ui';
import './github.css';

export type GitHubOptions = {
  theme: 'light' | 'dark';
  width: 'fluid' | 'phone' | 'sidebar';
  layout?: 'github' | 'isolated';
  thread?: 'pull' | 'issue';
  conversation?: 'short' | 'long';
  workspaceOpen?: boolean;
};

function nativeMarkdown(value: string): HTMLElement {
  const body = el('div', undefined, 'gh-markdown');
  body.innerHTML = DOMPurify.sanitize(marked.parse(value, { async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a', 'del', 'hr', 'details', 'summary'],
    ALLOWED_ATTR: ['href', 'title', 'open'],
  });
  for (const link of body.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  return body;
}

/** GitHub chrome is a local fixture. Extension forms/styles remain production code. */
export function githubEnvironment(options: GitHubOptions) {
  const isolated = options.layout === 'isolated';
  const frame = el('section', undefined, isolated ? 'gh-isolated' : 'gh-mock');
  frame.dataset.theme = options.theme; frame.dataset.width = options.width;
  frame.setAttribute('aria-label', isolated ? 'Story canvas' : 'Mock GitHub conversation');
  const caption = el('div', 'Storybook preview · GitHub UI is mocked; extension rendering is real. All comments stay local.', 'gh-demo-banner');
  frame.append(caption);
  const issue = options.thread === 'issue';
  if (!isolated) {
    const global = el('header', undefined, 'gh-global-header');
    global.append(el('span', 'GH', 'gh-logo'), el('strong', 'GitHub'), el('span', 'Product    Solutions    Open Source', 'gh-global-links'), el('span', 'Search or jump to…', 'gh-search'), el('span', 'A', 'gh-avatar gh-self'));
    const repo = el('div', undefined, 'gh-repo-header');
    const name = el('div', undefined, 'gh-repo-name'); name.append(el('span', '▣'), el('strong', 'example / project'), el('span', 'Public', 'gh-pill'));
    const repoTabs = el('nav', undefined, 'gh-repo-tabs'); repoTabs.setAttribute('aria-label', 'Repository navigation (visual fixture)');
    for (const tab of ['Code', 'Issues  12', 'Pull requests  3', 'Actions', 'Projects', 'Security', 'Insights']) repoTabs.append(el('span', tab, tab.startsWith(issue ? 'Issues' : 'Pull requests') ? 'selected' : ''));
    repo.append(name, repoTabs); frame.append(global, repo);
  }
  const main = el('main', undefined, 'gh-main'); frame.append(main);
  if (!isolated) {
    const title = el('header', undefined, 'gh-thread-header');
    const heading = el('h1', undefined, 'gh-thread-title'); heading.append('Make workspace feedback easier to review ', el('span', '#42', 'gh-muted'));
    const subtitle = el('div', undefined, 'gh-thread-subtitle'); subtitle.append(el('span', '◉ Open', 'gh-open'), el('span', issue ? 'alex opened this issue · 4 comments' : 'alex wants to merge 2 commits into main from feedback-ui'));
    title.append(heading, subtitle);
    const tabs = el('nav', undefined, 'gh-thread-tabs'); tabs.setAttribute('aria-label', 'Conversation navigation (visual fixture)');
    for (const text of issue ? ['Conversation  4'] : ['Conversation  4', 'Commits  2', 'Checks  4', 'Files changed  3']) tabs.append(el('span', text, text.startsWith('Conversation') ? 'selected' : ''));
    title.append(tabs); main.append(title);
  }
  const grid = el('div', undefined, 'gh-grid'); main.append(grid);
  const timeline = el('section', undefined, 'gh-timeline'); timeline.setAttribute('aria-label', 'Conversation timeline'); grid.append(timeline);
  const ownedHosts: HTMLElement[] = [];
  function appendComment(body: HTMLElement, author: string, time = 'just now', target = timeline): HTMLElement {
    if (isolated) { target.append(body); return body; }
    const row = el('article', undefined, 'gh-comment-row');
    row.append(el('div', author === 'you' ? 'A' : author.startsWith('github') ? '✦' : author.slice(0, 1).toUpperCase(), 'gh-avatar'));
    const card = el('div', undefined, 'gh-comment-card');
    const header = el('header', undefined, 'gh-comment-header');
    header.append(el('strong', author), el('span', `commented ${time}`, 'gh-muted'), el('span', author.startsWith('github') ? 'Bot' : 'Contributor', 'gh-pill'));
    const content = el('div', undefined, 'gh-comment-body markdown-body'); content.append(body);
    const footer = el('div', '☺  Add a reaction', 'gh-comment-footer'); card.append(header, content, footer); row.append(card); target.append(row);
    return row;
  }
  if (!isolated) {
    appendComment(nativeMarkdown('## What this changes\n\nThis update makes human–agent feedback easier to review directly in a conversation.\n\n- Keep questions and decisions next to the code.\n- Preserve the native GitHub comment workflow.\n- Make forms comfortable on desktop and mobile.'), 'alex', '2 hours ago');
    const event = el('div', '✓  alex added 2 commits · all 4 checks passed', 'gh-timeline-event'); timeline.append(event);
    if (options.conversation === 'long') for (let index = 0; index < 6; index++) appendComment(nativeMarkdown(`### Review note ${index + 1}\n\nWe discussed layout, keyboard focus, and how the form fits into the surrounding conversation. Scroll to the form, or use the extension’s pending-form control to open it in zen.\n\nThis extra timeline content lets you inspect offscreen navigation and the workspace overlay.`), index % 2 ? 'taylor' : 'alex', `${70 - index * 5} minutes ago`);
  }
  const recordBody = el('div'); recordBody.dataset.mockRecord = '';
  const sourceRow = appendComment(recordBody, 'github-ultimate[bot]', '20 minutes ago');
  const postedTimeline = el('div', undefined, 'gh-posted-timeline'); timeline.append(postedTimeline);
  const native = el('form', undefined, 'gh-composer'); native.setAttribute('aria-label', 'Local comment composer');
  const nativeHeading = el('h2', 'Leave a comment');
  const editorTabs = el('div', undefined, 'gh-editor-tabs'); editorTabs.setAttribute('role', 'tablist'); editorTabs.setAttribute('aria-label', 'Comment editor');
  const editor = el('textarea'); editor.id = 'new_comment_field'; editor.name = 'comment[body]'; editor.rows = 8;
  editor.setAttribute('aria-label', 'Local GitHub comment editor'); editor.value = 'My existing native comment draft.';
  const preview = el('div', undefined, 'gh-native-preview'); preview.hidden = true;
  const write = button('Write', () => setEditorTab(false)); const previewButton = button('Preview', () => setEditorTab(true));
  write.setAttribute('role', 'tab'); previewButton.setAttribute('role', 'tab');
  function setEditorTab(previewing: boolean) {
    editor.hidden = previewing; preview.hidden = !previewing;
    write.setAttribute('aria-selected', String(!previewing)); previewButton.setAttribute('aria-selected', String(previewing));
    if (previewing) preview.replaceChildren(nativeMarkdown(editor.value || 'Nothing to preview.'));
    updatePending();
  }
  editorTabs.append(write, previewButton);
  const receipt = el('p', undefined, 'gh-post-receipt'); receipt.setAttribute('role', 'status');
  let post = () => {};
  const submit = button('Comment', () => post()); submit.className = 'gh-comment-submit'; submit.title = 'Simulate posting locally; nothing is sent to GitHub';
  const footer = el('div', undefined, 'gh-editor-footer'); footer.append(el('span', 'Markdown is supported · local simulation only', 'gh-muted'), submit);
  native.append(nativeHeading, editorTabs, editor, preview, footer, receipt);
  native.addEventListener('submit', event => { event.preventDefault(); post(); });
  timeline.append(native);
  if (!isolated) {
    const sidebar = el('aside', undefined, 'gh-sidebar'); sidebar.setAttribute('aria-label', 'GitHub metadata sidebar');
    for (const [title, value] of [['Reviewers', 'taylor · review requested'], ['Assignees', 'alex'], ['Labels', 'frontend   accessibility'], ['Projects', 'Workspace experience'], ['Milestone', 'Mobile feedback'], ['Development', '2 commits · 4 passing checks']]) {
      const section = el('section'); section.append(el('h3', title), el('p', value)); sidebar.append(section);
    }
    grid.append(sidebar);
  }

  const workspace = el('div'); workspace.dataset.theme = options.theme;
  const workspaceRoot = shadow(workspace); ownedHosts.push(workspace);
  if (!isolated) frame.append(workspace);
  const launcher = button('✦ PR workspace', () => { panel.hidden = !panel.hidden; if (!panel.hidden) refreshPanel(); }, 'launcher');
  launcher.setAttribute('aria-label', 'Open GitHub Ultimate workspace'); workspaceRoot.append(launcher);
  const panel = el('aside', undefined, 'panel'); panel.hidden = !options.workspaceOpen;
  panel.setAttribute('aria-label', 'GitHub Ultimate PR workspace');
  const panelHeader = el('header', undefined, 'panel-header');
  panelHeader.append(button('Close', () => { panel.hidden = true; launcher.focus(); }, 'panel-close'), el('div', 'GitHub Ultimate', 'eyebrow'), el('h2', 'Your PR workspace'), el('p', 'example/project #42', 'muted'));
  const panelBody = el('div', undefined, 'panel-body'); panel.append(panelHeader, panelBody); workspaceRoot.append(panel);
  const pending = el('section', undefined, 'pending-navigation'); pending.hidden = true; pending.setAttribute('aria-label', 'Pending forms');
  pending.append(el('span', '1 form needs input', 'pending-count'), button('Go to form', () => { openForm(); panel.hidden = true; }, 'primary')); workspaceRoot.append(pending);
  let openForm = () => sourceRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let isComposing = () => false;
  let formTitle = '', hasForm = false, postedCount = 0, superseded = false;
  function refreshPanel() {
    panelBody.replaceChildren();
    panelBody.append(el('p', 'Storybook workspace scaffold using extension styles. Form/zen and saved-record controls use the shipping renderer.', 'tab-hint'));
    panelBody.append(el('h3', 'Forms & decisions'));
    if (hasForm) panelBody.append(button(`${superseded ? 'Superseded' : postedCount ? 'Submitted' : 'Needs input'} · ${formTitle}`, () => { panel.hidden = true; openForm(); }, 'record-link'));
    else panelBody.append(button('Find saved record', () => { panel.hidden = true; sourceRow.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 'record-link'));
    panelBody.append(el('p', postedCount ? `${postedCount} immutable response${postedCount === 1 ? '' : 's'}` : 'No response has been posted.', 'muted'));
  }
  function updatePending() {
    const bounds = sourceRow.getBoundingClientRect();
    const inView = bounds.top < innerHeight - 60 && bounds.bottom > 80;
    const active = document.activeElement;
    pending.hidden = isolated || !hasForm || superseded || postedCount > 0 || inView || isComposing() || Boolean(recordBody.querySelector('[data-gu-root]')?.shadowRoot?.querySelector('dialog[open]')) || Boolean(active && native.contains(active)) || editor.value.includes('```github-response');
  }
  const onFocus = () => queueMicrotask(updatePending);
  window.addEventListener('scroll', updatePending, { passive: true });
  window.addEventListener('resize', updatePending);
  window.addEventListener('gu-view-change', updatePending);
  document.addEventListener('focusin', onFocus); document.addEventListener('focusout', onFocus);
  editor.addEventListener('input', updatePending);
  workspace.addEventListener('gu-key', event => { if ((event as CustomEvent<KeyboardEvent>).detail.key === 'Escape') { panel.hidden = true; launcher.focus(); } });
  setEditorTab(false); refreshPanel();
  return {
    frame, recordBody, native, editor, receipt,
    setPost(handler: () => void) { post = handler; },
    setForm(title: string, invalidated: boolean, open: () => void, composing: () => boolean) {
      hasForm = true; formTitle = title; superseded = invalidated; openForm = open; isComposing = composing;
      refreshPanel(); updatePending();
    },
    setPosted(count: number) { postedCount = count; refreshPanel(); updatePending(); },
    resetEditor() { editor.value = ''; setEditorTab(false); },
    appendPosted(body: HTMLElement, author = 'you') { appendComment(body, author, 'just now', postedTimeline); },
    appendNativePosted(value: string) { appendComment(nativeMarkdown(value), 'you', 'just now', postedTimeline); },
    dispose() {
      for (const host of ownedHosts) host.dispatchEvent(new Event('gu-dispose'));
      window.removeEventListener('scroll', updatePending); window.removeEventListener('resize', updatePending);
      window.removeEventListener('gu-view-change', updatePending);
      document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onFocus);
    },
  };
}

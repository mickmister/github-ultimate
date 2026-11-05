import { parseRecord, revisionOf, type RecordData, type TaskForm, type Snapshot, type ResponseRecord } from './protocol';
import { defaults, settings, type Settings } from './storage';
import { el, button, shadow, renderForm, renderSnapshot, renderResponse } from './ui';

type Mounted = { code: HTMLElement; raw: string; host: HTMLElement; data?: RecordData; error?: string; sourceId: string; revision?: string };
let config: Settings = { ...defaults };
let route = '', mounted = new Map<HTMLElement, Mounted>();
let shell: HTMLElement | undefined, shellRoot: ShadowRoot | undefined, panel: HTMLElement | undefined, body: HTMLElement | undefined;
let selected = 'overview', panelOpen = false, busy = false, rerun = false;
let scanTimer: ReturnType<typeof setTimeout>;

export function context(path = location.pathname) {
  const match = /^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)(?:\/|$)/.exec(path);
  return match ? { repository: `${match[1]}/${match[2]}`, number: Number(match[4]), type: match[3] } : null;
}
function theme(host: HTMLElement) {
  const html = document.documentElement;
  const mode = html.getAttribute('data-color-mode');
  host.dataset.theme = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function dispose(item: Mounted) {
  item.host.dispatchEvent(new Event('gu-dispose')); item.host.remove(); item.code.hidden = false;
}
function cleanup() {
  for (const item of mounted.values()) dispose(item);
  mounted.clear(); shell?.remove(); shell = undefined; shellRoot = undefined; body = undefined; panel = undefined;
}
function sourceId(code: HTMLElement): string {
  const comment = code.closest<HTMLElement>('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], .timeline-comment, [data-comment-id]');
  if (comment?.id) return comment.id;
  const link = comment?.querySelector<HTMLAnchorElement>('a[href*="#issuecomment-"], a[href*="#discussion_r"]');
  return link?.hash.slice(1) || comment?.dataset.commentId || 'description';
}
function candidates(): HTMLElement[] {
  const bodies = document.querySelectorAll('.comment-body, .js-comment-body, [data-testid="comment-body"], [data-testid="markdown-body"]');
  const blocks = new Set<HTMLElement>();
  for (const comment of bodies) for (const block of comment.querySelectorAll<HTMLElement>('pre')) {
    // Ignore quoted examples; only top-level comment-owned records are actionable.
    if (!block.closest('blockquote')) blocks.add(block);
  }
  return [...blocks];
}
function isRecord(block: HTMLElement, raw: string) {
  const hint = `${block.className} ${block.parentElement?.className ?? ''} ${block.querySelector('code')?.className ?? ''}`;
  return /github-task|github-workflow|github-response/.test(hint) || /["']?format["']?\s*:\s*["']?standard\b/.test(raw) || /["']?kind["']?\s*:\s*["']?(workflow|response)\b/.test(raw);
}
function makeShell() {
  shell = el('div'); shell.id = 'github-ultimate-workspace'; theme(shell); document.body.append(shell); shellRoot = shadow(shell);
  const launch = button('✦ PR workspace', () => { panelOpen = !panelOpen; panel!.hidden = !panelOpen; if (panelOpen) panel!.querySelector<HTMLButtonElement>('.panel-close')?.focus(); }, 'launcher');
  launch.setAttribute('aria-label', 'Open GitHub Ultimate workspace'); shellRoot.append(launch);
  panel = el('aside', undefined, 'panel'); panel.hidden = !panelOpen; panel.setAttribute('aria-label', 'GitHub Ultimate PR workspace');
  const header = el('header', undefined, 'panel-header');
  header.append(button('Close', () => { panelOpen = false; panel!.hidden = true; launch.focus(); }, 'panel-close'), el('div', 'GITHUB ULTIMATE', 'eyebrow'), el('h2', 'Your PR workspace'));
  header.append(el('p', `${context()!.repository} #${context()!.number}`, 'muted'));
  const tabs = el('nav', undefined, 'tabs'); tabs.setAttribute('aria-label', 'Workspace views');
  for (const [id, label] of [['overview', 'Overview'], ['forms', 'Forms'], ['runs', 'Runs & beads']]) {
    const tab = button(label, () => { selected = id; updatePanel(); }); tab.dataset.tab = id; tabs.append(tab);
  }
  header.append(tabs); body = el('div', undefined, 'panel-body'); panel.append(header, body); shellRoot.append(panel);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { panelOpen = false; panel!.hidden = true; launch.focus(); } });
}
function updatePanel() {
  if (!body || !context()) return;
  for (const tab of shellRoot!.querySelectorAll<HTMLElement>('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === selected));
  body.replaceChildren();
  const all = [...mounted.values()];
  const forms = all.filter((item): item is Mounted & { data: TaskForm } => Boolean(item.data && 'format' in item.data));
  const runs = all.filter((item): item is Mounted & { data: Snapshot } => Boolean(item.data && 'kind' in item.data && item.data.kind === 'workflow'));
  const responses = all.filter((item): item is Mounted & { data: ResponseRecord } => Boolean(item.data && 'kind' in item.data && item.data.kind === 'response'));
  const answer = (item: Mounted & { data: TaskForm }) => responses.filter(r => r.data.form_id === item.data.id && r.data.source.comment_id === item.sourceId && r.data.source.revision === item.revision && r.data.source.repository === context()!.repository && r.data.source.number === context()!.number).at(-1);
  const answered = (item: Mounted & { data: TaskForm }) => Boolean(answer(item));
  for (const item of forms) {
    const root = item.host.shadowRoot!;
    root.querySelector('.answered-notice')?.remove();
    const saved = answer(item);
    if (saved && !item.data.invalidatedAt) {
      const note = el('div', undefined, 'notice answered-notice'); note.append(el('p', 'An answer to this form is saved in the loaded comments.'));
      note.append(button('Load saved answers to edit', () => item.host.dispatchEvent(new CustomEvent('gu-load-answers', { detail: saved.data.answers }))));
      root.querySelector('.form-card')?.prepend(note);
    }
  }
  const latest = new Map<string, typeof runs[number]>();
  for (const item of runs) if (!latest.has(item.data.task_id) || Date.parse(item.data.updated_at) > Date.parse(latest.get(item.data.task_id)!.data.updated_at)) latest.set(item.data.task_id, item);
  const pending = forms.filter(item => !item.data.invalidatedAt && !answered(item));
  const grid = el('div', undefined, 'summary-grid');
  for (const [count, title] of [[pending.length, 'awaiting answers'], [[...latest.values()].filter(item => item.data.status === 'running').length, 'running'], [[...latest.values()].filter(item => item.data.status === 'failed' || item.data.status === 'needs-input').length, 'need attention']]) {
    const metric = el('div', undefined, 'metric'); metric.append(el('strong', String(count)), String(title)); grid.append(metric);
  }
  body.append(grid);
  const toolbar = el('div', undefined, 'toolbar'); toolbar.append(el('span', `${all.length} records in loaded comments`, 'muted'), button('Rescan', schedule)); body.append(toolbar);
  body.append(el('p', 'Load older comments in GitHub to include them. This view reads saved comment records, not live workflow APIs.', 'tab-hint'));
  function jump(item: Mounted) {
    item.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!config.inlineForms) { config.inlineForms = true; rebuildInline(); }
    panelOpen = false; panel!.hidden = true;
  }
  if (selected !== 'runs') {
    body.append(el('h3', 'Forms & decisions'));
    for (const item of forms) body.append(button(`${item.data.invalidatedAt ? 'Superseded · ' : answered(item) ? 'Answered · ' : 'Needs input · '}${item.data.title}${item.data.session_id ? ' · continued session' : ''}`, () => jump(item), 'record-link'));
    if (!forms.length) body.append(el('p', 'No forms yet. Add a github-task JSON or YAML comment using the examples in the project guide.', 'empty'));
    for (const item of responses) body.append(renderResponse(item.data));
  }
  if (selected !== 'forms') {
    body.append(el('h3', selected === 'runs' ? 'Saved workflow history' : 'Latest task progress'));
    const records = selected === 'runs' ? runs.sort((a, b) => Date.parse(b.data.updated_at) - Date.parse(a.data.updated_at)) : [...latest.values()];
    for (const item of records) {
      const card = renderSnapshot(item.data, context()!.repository); card.append(button('Find source comment', () => jump(item))); body.append(card);
    }
    if (!records.length) body.append(el('p', 'No saved workflow snapshots. A manual github-workflow comment can show run details, private dashboard links and bead progress before handlers are installed.', 'empty'));
  }
  for (const item of all.filter(item => item.error)) body.append(el('p', `Invalid record in ${item.sourceId}: ${item.error}`, 'error'));
}
function rebuildInline() { for (const item of mounted.values()) dispose(item); mounted.clear(); schedule(); }
function schedule() { clearTimeout(scanTimer); scanTimer = setTimeout(() => { void scan(); }, 120); }
async function scan() {
  if (busy) { rerun = true; return; } busy = true;
  try {
    const current = context(); const key = current ? `${current.repository}/${current.type}/${current.number}` : '';
    if (route !== key || !config.enabled || !shell?.isConnected) { cleanup(); route = key; }
    if (!key || !config.enabled) return;
    if (!shell) makeShell();
    let changed = false;
    for (const [code, item] of mounted) {
      if (!code.isConnected || code.textContent !== item.raw) { dispose(item); mounted.delete(code); changed = true; }
    }
    for (const code of candidates()) {
      const raw = code.textContent ?? '';
      if (mounted.has(code) || !isRecord(code, raw)) continue;
      const host = el('div'); host.className = 'github-ultimate-record'; theme(host);
      const item: Mounted = { code, raw, host, sourceId: sourceId(code) };
      const root = shadow(host);
      try {
        item.data = parseRecord(raw);
        const revision = await revisionOf(raw);
        item.revision = revision;
        if (key !== (context() ? `${context()!.repository}/${context()!.type}/${context()!.number}` : '') || !code.isConnected || code.textContent !== raw) { rerun = true; continue; }
        if ('format' in item.data) {
          if (config.inlineForms) renderForm(root, item.data, { repository: current!.repository, number: current!.number, comment_id: item.sourceId, revision }, () => code.isConnected && code.textContent === raw && sourceId(code) === item.sourceId && route === key && `${context()?.repository}/${context()?.type}/${context()?.number}` === key, config.rememberDrafts);
          else root.append(el('p', `Form: ${item.data.title} · enable inline forms in extension settings`, 'notice'));
        } else if (item.data.kind === 'workflow') root.append(renderSnapshot(item.data, current!.repository));
        else root.append(renderResponse(item.data));
      } catch (e) { item.error = (e as Error).message.slice(0, 1000); root.append(el('p', `GitHub Ultimate could not render this record: ${item.error}`, 'error')); }
      if (!item.error) {
        code.hidden = true;
        root.append(button('Show / hide original record', () => { code.hidden = !code.hidden; }, 'raw-toggle'));
      }
      code.insertAdjacentElement('afterend', host); mounted.set(code, item); changed = true;
    }
    if (changed || !body?.childElementCount) updatePanel();
    theme(shell!); for (const item of mounted.values()) theme(item.host);
  } finally { busy = false; if (rerun) { rerun = false; schedule(); } }
}

async function boot() {
  config = await settings();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'] });
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) window.addEventListener(event, schedule);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { void settings().then(value => { config = value; rebuildInline(); }); }
  });
  // GitHub can change route without a body mutation. No network polling is performed.
  setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, 2000);
  await scan();
}
void boot();

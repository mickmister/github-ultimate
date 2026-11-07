import { parseRecord, revisionOf, type RecordData, type TaskForm, type Snapshot, type ResponseRecord } from './protocol';
import { defaults, settings, type Settings } from './storage';
import { el, button, shadow, renderForm, renderRecordTools, renderSnapshot, renderResponse, type FormController } from './ui';
import { isolateExtensionKeyboard } from './keyboard';
import { extensionAPI } from './extension-api';

isolateExtensionKeyboard();

type Mounted = { code: HTMLElement; presentation: HTMLElement; originallyHidden: boolean; raw: string; host: HTMLElement; data?: RecordData; error?: string; sourceId: string; revision?: string; controller?: FormController };
let config: Settings = { ...defaults };
let route = '', mounted = new Map<HTMLElement, Mounted>();
let shell: HTMLElement | undefined, shellRoot: ShadowRoot | undefined, panel: HTMLElement | undefined, body: HTMLElement | undefined;
let selected = 'overview', panelOpen = false, busy = false, rerun = false;
let scanTimer: ReturnType<typeof setTimeout>;
let pendingForms: Mounted[] = [], pendingNavigation: HTMLElement | undefined, pendingSelect: HTMLSelectElement | undefined;
let selectedPending = '';
const pendingKey = (item: Mounted) => `${item.sourceId}:${'format' in (item.data ?? {}) ? (item.data as TaskForm).id : ''}`;

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
  item.host.dispatchEvent(new Event('gu-dispose')); item.host.remove(); item.presentation.hidden = item.originallyHidden;
}
function cleanup() {
  for (const item of mounted.values()) dispose(item);
  mounted.clear(); shell?.dispatchEvent(new Event('gu-dispose')); shell?.remove(); shell = undefined; shellRoot = undefined; body = undefined; panel = undefined; pendingForms = []; pendingNavigation = undefined;
}
function sourceId(code: HTMLElement): string {
  const comment = code.closest<HTMLElement>('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], .timeline-comment, [data-comment-id]');
  if (comment?.id) return comment.id;
  const link = comment?.querySelector<HTMLAnchorElement>('a[href*="#issuecomment-"], a[href*="#discussion_r"]');
  return link?.hash.slice(1) || comment?.dataset.commentId || 'description';
}
function candidates(): HTMLElement[] {
  // GitHub serves different timeline layouts across accounts and rollouts.
  // Recognize Markdown bodies as well as stable comment containers, rather
  // than depending entirely on a particular body wrapper/test ID.
  const bodies = document.querySelectorAll('.comment-body, .js-comment-body, .markdown-body, [data-testid="comment-body"], [data-testid="markdown-body"], [id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [data-comment-id]');
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
function presentationFor(code: HTMLElement): HTMLElement {
  const details = code.closest('details');
  const label = details?.querySelector(':scope > summary')?.textContent ?? '';
  return details && (label.startsWith('Form: ') || label === 'Submitted answers · GitHub Ultimate') ? details : code;
}
function ensureController(item: Mounted) {
  if (item.controller || !item.data || !('format' in item.data)) return;
  const current = context(); if (!current) return;
  const key = route;
  const root = item.host.shadowRoot!;
  root.querySelector('.inline-disabled')?.remove();
  root.querySelector('.record-tools')?.remove();
  item.controller = renderForm(root, item.data, { repository: current.repository, number: current.number, comment_id: item.sourceId, revision: item.revision! }, () => item.code.isConnected && item.code.textContent === item.raw && sourceId(item.code) === item.sourceId && route === key && `${context()?.repository}/${context()?.type}/${context()?.number}` === key, config.rememberDrafts, config.showDiagnosticJson ? () => { item.presentation.hidden = !item.presentation.hidden; } : undefined);
}
function openForm(item: Mounted, zen = true) {
  ensureController(item);
  if (zen) item.controller?.openZen(); else item.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (panel) panel.hidden = true; panelOpen = false; updatePendingNavigation();
}
function updatePendingNavigation() {
  if (!pendingNavigation || !pendingSelect) return;
  // Composition is not submission. Keep counts/history pending, but let the
  // person review, paste, preview and click Comment without a sticky prompt.
  const active = document.activeElement;
  const editingNative = [...document.querySelectorAll<HTMLTextAreaElement>('#new_comment_field, textarea[name="comment[body]"], textarea[placeholder="Leave a comment"]')]
    .some(input => {
      const form = input.closest('form');
      // GitHub's Preview tab may hide the textarea while retaining its draft.
      return !input.closest('.js-comment-update') && (input.getClientRects().length > 0 || Boolean(form?.getClientRects().length)) &&
        (input === active || Boolean(active && form?.contains(active)) || input.value.includes('```github-response'));
    });
  if (editingNative || [...mounted.values()].some(item => item.controller?.isComposingResponse())) { pendingNavigation.hidden = true; return; }
  if (!pendingForms.some(item => pendingKey(item) === selectedPending)) selectedPending = pendingForms[0] ? pendingKey(pendingForms[0]) : '';
  const target = pendingForms.find(item => pendingKey(item) === selectedPending);
  if (!target) { pendingNavigation.hidden = true; return; }
  const rect = target.host.getBoundingClientRect();
  const inView = rect.height > 0 && rect.top < innerHeight - 60 && rect.bottom > 80;
  pendingNavigation.hidden = inView || Boolean(target.host.shadowRoot?.querySelector('dialog')?.open);
  pendingSelect.hidden = pendingForms.length < 2;
  pendingNavigation.querySelector('.pending-count')!.textContent = `${pendingForms.length} form${pendingForms.length === 1 ? '' : 's'} need${pendingForms.length === 1 ? 's' : ''} input`;
}
function makeShell() {
  shell = el('div'); shell.id = 'github-ultimate-workspace'; theme(shell); document.body.append(shell); shellRoot = shadow(shell);
  const launch = button('✦ PR workspace', () => { panelOpen = !panelOpen; panel!.hidden = !panelOpen; if (panelOpen) panel!.querySelector<HTMLButtonElement>('.panel-close')?.focus(); }, 'launcher');
  launch.setAttribute('aria-label', 'Open GitHub Ultimate workspace'); shellRoot.append(launch);
  panel = el('aside', undefined, 'panel'); panel.hidden = !panelOpen; panel.setAttribute('aria-label', 'GitHub Ultimate PR workspace');
  const header = el('header', undefined, 'panel-header');
  header.append(button('Close', () => { panelOpen = false; panel!.hidden = true; launch.focus(); }, 'panel-close'), el('div', 'GitHub Ultimate', 'eyebrow'), el('h2', 'Your PR workspace'));
  header.append(el('p', `${context()!.repository} #${context()!.number}`, 'muted'));
  const tabs = el('nav', undefined, 'tabs'); tabs.setAttribute('aria-label', 'Workspace views');
  for (const [id, label] of [['overview', 'Overview'], ['forms', 'Forms'], ['runs', 'Runs & beads']]) {
    const tab = button(label, () => { selected = id; updatePanel(); }); tab.dataset.tab = id; tabs.append(tab);
  }
  header.append(tabs); body = el('div', undefined, 'panel-body'); panel.append(header, body); shellRoot.append(panel);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { panelOpen = false; panel!.hidden = true; launch.focus(); } });
  shell.addEventListener('gu-key', event => { if ((event as CustomEvent<KeyboardEvent>).detail.key === 'Escape' && panelOpen) { panelOpen = false; panel!.hidden = true; launch.focus(); } });
  pendingNavigation = el('section', undefined, 'pending-navigation'); pendingNavigation.hidden = true;
  pendingNavigation.setAttribute('aria-label', 'Pending forms');
  const count = el('span', '', 'pending-count'); count.setAttribute('role', 'status');
  pendingSelect = el('select'); pendingSelect.setAttribute('aria-label', 'Choose pending form');
  pendingSelect.addEventListener('change', () => { selectedPending = pendingSelect!.value; updatePendingNavigation(); });
  pendingNavigation.append(count, pendingSelect, button('Go to form', () => { const item = pendingForms.find(item => pendingKey(item) === selectedPending); if (item) openForm(item); }, 'primary'));
  shellRoot.append(pendingNavigation);
}
function updatePanel() {
  if (!body || !context()) return;
  for (const tab of shellRoot!.querySelectorAll<HTMLElement>('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === selected));
  body.replaceChildren();
  const all = [...mounted.values()];
  const forms = all.filter((item): item is Mounted & { data: TaskForm } => Boolean(item.data && 'format' in item.data));
  const runs = all.filter((item): item is Mounted & { data: Snapshot } => Boolean(item.data && 'kind' in item.data && item.data.kind === 'workflow'));
  const responses = all.filter((item): item is Mounted & { data: ResponseRecord } => Boolean(item.data && 'kind' in item.data && item.data.kind === 'response'));
  const answers = (item: Mounted & { data: TaskForm }) => responses.filter(r => r.data.form_id === item.data.id && r.data.source.comment_id === item.sourceId && r.data.source.revision === item.revision && r.data.source.repository === context()!.repository && r.data.source.number === context()!.number);
  const answered = (item: Mounted & { data: TaskForm }) => answers(item).length > 0;
  for (const item of forms) {
    if (!item.data.invalidatedAt) item.controller?.setResponses(answers(item).map(entry => ({ record: entry.data, url: `https://github.com/${context()!.repository}/pull/${context()!.number}#${entry.sourceId}` })));
  }
  const latest = new Map<string, typeof runs[number]>();
  for (const item of runs) if (!latest.has(item.data.task_id) || Date.parse(item.data.updated_at) > Date.parse(latest.get(item.data.task_id)!.data.updated_at)) latest.set(item.data.task_id, item);
  const pending = forms.filter(item => !item.data.invalidatedAt && !answered(item));
  pendingForms = pending;
  pendingSelect?.replaceChildren(...pending.map(item => { const option = el('option', item.data.title); option.value = pendingKey(item); return option; }));
  if (pendingSelect && pending.some(item => pendingKey(item) === selectedPending)) pendingSelect.value = selectedPending;
  updatePendingNavigation();
  const grid = el('div', undefined, 'summary-grid');
  for (const [count, title] of [[pending.length, 'awaiting answers'], [[...latest.values()].filter(item => item.data.status === 'running').length, 'running'], [[...latest.values()].filter(item => item.data.status === 'failed' || item.data.status === 'needs-input').length, 'need attention']]) {
    const metric = el('div', undefined, 'metric'); metric.append(el('strong', String(count)), String(title)); grid.append(metric);
  }
  body.append(grid);
  const toolbar = el('div', undefined, 'toolbar'); toolbar.append(el('span', `${all.length} records in loaded comments`, 'muted'), button('Rescan', schedule)); body.append(toolbar);
  body.append(el('p', 'Load older comments in GitHub to include them. This view reads saved comment records, not live workflow APIs.', 'tab-hint'));
  function jump(item: Mounted) {
    openForm(item, Boolean(item.data && 'format' in item.data && !answered(item as Mounted & { data: TaskForm })));
  }
  if (selected !== 'runs') {
    body.append(el('h3', 'Forms & decisions'));
    for (const item of forms) body.append(button(`${item.data.invalidatedAt ? 'Superseded · ' : answered(item) ? 'Submitted · ' : 'Needs input · '}${item.data.title}${item.data.session_id ? ' · continued session' : ''}`, () => jump(item), 'record-link'));
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
      const presentation = presentationFor(code);
      const item: Mounted = { code, presentation, originallyHidden: presentation.hidden, raw, host, sourceId: sourceId(code) };
      const root = shadow(host);
      try {
        item.data = parseRecord(raw);
        const revision = await revisionOf(raw);
        item.revision = revision;
        if (key !== (context() ? `${context()!.repository}/${context()!.type}/${context()!.number}` : '') || !code.isConnected || code.textContent !== raw) { rerun = true; continue; }
        if ('format' in item.data) {
          if (config.inlineForms) ensureController(item);
          else root.append(el('p', `Form: ${item.data.title} · open from the PR workspace`, 'notice inline-disabled'));
        } else if (item.data.kind === 'workflow') root.append(renderSnapshot(item.data, current!.repository));
        else root.append(renderResponse(item.data));
      } catch (e) { item.error = (e as Error).message.slice(0, 1000); root.append(el('p', `GitHub Ultimate could not render this record: ${item.error}`, 'error')); }
      if (!item.error) {
        presentation.hidden = true;
        if (config.showDiagnosticJson && !item.controller) root.append(renderRecordTools(undefined, () => { presentation.hidden = !presentation.hidden; }));
      }
      presentation.insertAdjacentElement('afterend', host); mounted.set(code, item); changed = true;
    }
    if (changed || !body?.childElementCount) updatePanel();
    theme(shell!); for (const item of mounted.values()) theme(item.host);
    updatePendingNavigation();
  } finally { busy = false; if (rerun) { rerun = false; schedule(); } }
}

async function boot() {
  if (!document.body) await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  config = await settings();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'] });
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) window.addEventListener(event, schedule);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  window.addEventListener('scroll', updatePendingNavigation, { passive: true });
  window.addEventListener('resize', updatePendingNavigation);
  window.addEventListener('gu-view-change', updatePendingNavigation);
  document.addEventListener('focusin', updatePendingNavigation);
  document.addEventListener('focusout', () => queueMicrotask(updatePendingNavigation));
  document.addEventListener('input', updatePendingNavigation);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
  extensionAPI().storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { void settings().then(value => { config = value; rebuildInline(); }); }
  });
  // GitHub can change route without a body mutation. No network polling is performed.
  setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, 2000);
  await scan();
}
void boot();

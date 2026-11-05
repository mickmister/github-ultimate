import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { composeResponse, validateAnswers, safeLink, type TaskForm, type Answers, type Snapshot, type ResponseRecord } from './protocol';
import { read, write } from './storage';
import css from './workspace.css?inline';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function markdown(text: string | undefined): HTMLDivElement {
  const node = el('div', undefined, 'markdown');
  node.innerHTML = DOMPurify.sanitize(marked.parse(text ?? '', { async: false }), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a', 'del', 'hr'], ALLOWED_ATTR: ['href', 'title'] });
  for (const a of node.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!/^https:\/\//i.test(href)) a.removeAttribute('href');
    a.target = '_blank'; a.rel = 'noopener noreferrer';
  }
  return node;
}
export function shadow(host: HTMLElement): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' }); const style = el('style'); style.textContent = css; root.append(style); return root;
}
function notes(label: string, name: string, values: Answers): HTMLDetailsElement {
  const details = el('details', undefined, 'notes'); details.append(el('summary', label));
  const input = el('textarea'); input.name = name; input.rows = 3; input.maxLength = 16000; input.setAttribute('aria-label', label);
  input.value = typeof values[name] === 'string' ? values[name] as string : '';
  input.addEventListener('input', () => { values[name] = input.value; });
  details.append(input); if (input.value) details.open = true; return details;
}
export type Source = { repository: string; number: number; comment_id: string; revision: string };

export async function copyText(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const field = el('textarea'); field.value = value; field.style.position = 'fixed'; field.style.top = '0'; document.body.append(field); field.focus(); field.select();
    const copied = document.execCommand('copy'); field.remove();
    if (!copied) throw new Error('Clipboard unavailable. Select and copy the preview text manually.');
  }
}
export function insertComment(value: string): void {
  const candidates = [...document.querySelectorAll<HTMLTextAreaElement>('#new_comment_field, textarea[name="comment[body]"], textarea[placeholder="Leave a comment"]')];
  const input = candidates.find(node => !node.disabled && node.getClientRects().length && !node.closest('.js-comment-update'));
  if (!input) throw new Error('Open the GitHub conversation comment editor, or copy the preview and paste it manually.');
  if (input.value.includes(value)) { input.focus(); return; }
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(input, [input.value.trimEnd(), value].filter(Boolean).join('\n\n'));
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus();
}

export function renderForm(root: ShadowRoot, form: TaskForm, source: Source, isCurrent: () => boolean, remember: boolean): void {
  const card = el('section', undefined, 'form-card'); root.append(card);
  card.append(el('div', 'GITHUB ULTIMATE / QUESTIONNAIRE', 'eyebrow'), el('h2', form.title));
  if (form.goal) card.append(markdown(`**Goal:** ${form.goal}`));
  if (form.description) { const detail = el('details'); detail.append(el('summary', 'Context'), markdown(form.description)); card.append(detail); }
  if (form.session_id) card.append(el('p', `Session ${form.session_id} · follow-up keeps this context`, 'muted'));
  if (form.invalidatedAt) { card.append(el('p', `This form was superseded. ${form.invalidatedReason ?? ''}`, 'notice')); return; }
  const values: Answers = {};
  const htmlForm = el('form'); card.append(htmlForm);
  const status = el('p', '', 'muted'); status.setAttribute('role', 'status');
  const errors = el('div', undefined, 'error'); errors.setAttribute('role', 'alert');
  const key = `draft:${source.repository}:${source.number}:${source.comment_id}:${form.id}:${source.revision}`;
  let disposed = false, changed = false, timer: ReturnType<typeof setTimeout>;
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  for (const q of form.questions) {
    const fieldset = el('fieldset'); fieldset.append(el('legend', q.title), markdown(q.description));
    if (q.type === 'choices') {
      values[q.id] = Object.fromEntries(q.choices.map(c => [c.id, false]));
      const grouped = new Set((q.choiceGroups ?? []).flatMap(g => g.choiceIds));
      const choiceNodes = new Map<string, HTMLElement>();
      for (const c of q.choices) {
        const row = el('div', undefined, 'choice'); const label = el('label', undefined, 'choice-label'); const input = el('input');
        input.type = 'checkbox'; input.name = q.id; input.value = c.id;
        controls.set(`${q.id}:${c.id}`, input);
        input.addEventListener('change', () => {
          (values[q.id] as Record<string, boolean>)[c.id] = input.checked;
          const group = q.choiceGroups?.find(g => g.choiceIds.includes(c.id) && g.mode !== 'any');
          if (input.checked && group) for (const name of group.choiceIds) if (name !== c.id) {
            const other = controls.get(`${q.id}:${name}`) as HTMLInputElement;
            other.checked = false; (values[q.id] as Record<string, boolean>)[name] = false;
          }
        });
        label.append(input, el('span', c.label)); row.append(label);
        if (c.assumedTrue) row.append(el('span', 'Author assumption · not preselected', 'badge'));
        if (c.description) row.append(markdown(c.description));
        if (c.is_recommended_reason) row.append(el('p', `Recommended · ${c.is_recommended_reason}`, 'recommended'));
        if (c.prosAndCons) for (const [kind, items] of Object.entries(c.prosAndCons)) if (items?.length) row.append(markdown(`**${kind === 'pros' ? 'Pros' : 'Cons'}**\n${items.map(s => `- ${s}`).join('\n')}`));
        row.append(notes(`More info about ${c.label}`, `${q.id}_${c.id}_more_info`, values)); choiceNodes.set(c.id, row);
      }
      for (const g of q.choiceGroups ?? []) {
        const block = el('section', undefined, 'choice-group'); if (g.title) block.append(el('h4', g.title));
        if (g.description) block.append(markdown(g.description));
        if (g.mode !== 'any') block.append(el('p', g.mode === 'exactlyOne' ? 'Choose exactly one' : 'Choose at most one', 'muted'));
        for (const name of g.choiceIds) block.append(choiceNodes.get(name)!); fieldset.append(block);
      }
      for (const c of q.choices) if (!grouped.has(c.id)) fieldset.append(choiceNodes.get(c.id)!);
    } else {
      const input = q.type === 'text' ? el('input') : el('textarea');
      input.name = q.id; input.setAttribute('aria-label', q.title); input.placeholder = q.placeholder ?? ''; input.maxLength = 16000;
      if (input instanceof HTMLTextAreaElement) input.rows = 5;
      if (q.required) input.required = true;
      controls.set(q.id, input); input.addEventListener('input', () => { values[q.id] = input.value; }); fieldset.append(input);
    }
    if (q.required) fieldset.append(el('small', 'Required', 'muted'));
    if (q.id !== 'additional_notes') fieldset.append(notes(`More info for ${q.title}`, `${q.id}_more_info`, values));
    htmlForm.append(fieldset);
  }
  if (!form.questions.some(q => q.id === 'additional_notes')) {
    const label = el('label', 'Additional notes'); const input = el('textarea'); input.rows = 4; input.name = 'additional_notes'; input.maxLength = 16000;
    input.addEventListener('input', () => { values.additional_notes = input.value; }); controls.set('additional_notes', input); label.append(input); htmlForm.append(label);
  }
  const next = el('label', 'Next instruction (optional)'); const nextInput = el('textarea'); nextInput.rows = 3; nextInput.name = 'next_instruction'; nextInput.maxLength = 8000;
  nextInput.addEventListener('input', () => { values.next_instruction = nextInput.value; }); controls.set('next_instruction', nextInput);
  const presets = el('div', undefined, 'actions');
  for (const p of form.nextInstructionPresets ?? [{ label: 'Discuss remaining questions', value: 'Ask follow-up questions before implementing.' }]) presets.append(button(p.label, () => { nextInput.value = p.value; nextInput.dispatchEvent(new Event('input', { bubbles: true })); }));
  next.append(presets, nextInput); htmlForm.append(next);
  const actions = el('div', undefined, 'actions');
  const config = typeof form.allowCodeFileChanges === 'object' ? form.allowCodeFileChanges : undefined;
  const preview = el('section', undefined, 'preview'); preview.hidden = true;
  const previewText = el('textarea'); previewText.readOnly = true; previewText.rows = 12; previewText.setAttribute('aria-label', 'Generated comment preview');
  const previewStatus = el('p'); previewStatus.setAttribute('role', 'status');
  function prepare(approved: boolean) {
    errors.replaceChildren();
    if (!isCurrent()) { errors.textContent = 'The source form changed or is no longer on this page. Refresh before answering.'; return; }
    const problems = validateAnswers(form, values); if (!htmlForm.reportValidity() || problems.length) { errors.textContent = problems.join('\n'); return; }
    try {
      previewText.value = composeResponse(form, values, source, approved); preview.hidden = false;
      previewStatus.textContent = approved ? 'Approved next steps. Review the command, then place it in GitHub’s editor.' : 'Discussion only. This command explicitly disallows implementation.';
      preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errors.textContent = String(e); }
  }
  if (form.allowCodeFileChanges !== false) actions.append(button(config?.allowLabel ?? config?.label ?? 'Approved for next steps', () => prepare(true), 'primary'));
  actions.append(button(config?.avoidLabel ?? 'Continue discussion — don’t implement yet', () => prepare(false)));
  htmlForm.addEventListener('submit', event => { event.preventDefault(); prepare(false); });
  htmlForm.append(errors, markdown(config?.description), actions, status);
  preview.append(el('h3', 'Review your comment'), previewStatus, previewText);
  const previewActions = el('div', undefined, 'actions');
  previewActions.append(button('Place in GitHub comment editor', () => {
    if (!isCurrent()) { previewStatus.textContent = 'Source changed. Refresh and review again.'; return; }
    try { insertComment(previewText.value); previewStatus.textContent = 'Draft inserted. Click GitHub’s Comment button to submit. No workflow handler is installed by this extension.'; }
    catch (e) { previewStatus.textContent = (e as Error).message; }
  }, 'primary'), button('Copy comment', () => { void copyText(previewText.value).then(() => { previewStatus.textContent = 'Copied.'; }).catch(e => { previewStatus.textContent = e.message; }); }), button('Close preview', () => { preview.hidden = true; }));
  preview.append(previewActions); card.append(preview);
  const save = () => {
    changed = true; clearTimeout(timer);
    if (remember) timer = setTimeout(() => {
      if (!disposed) void write(key, values).then(() => { status.textContent = 'Draft saved in this Chrome profile.'; }).catch(() => { status.textContent = 'Could not save draft locally. Keep this page open or copy your answers.'; });
    }, 250);
  };
  htmlForm.addEventListener('input', save); htmlForm.addEventListener('change', save);
  function restore(saved: Answers) {
    // Restore only declared form fields; stored drafts are never interpreted as HTML.
    for (const [name, input] of controls) {
      const [qid, cid] = name.split(':');
      if (cid && input instanceof HTMLInputElement) {
        const choice = saved[qid]; const checked = choice && typeof choice === 'object' && choice[cid] === true;
        input.checked = Boolean(checked); (values[qid] as Record<string, boolean>)[cid] = Boolean(checked);
      } else if (typeof saved[name] === 'string') { input.value = saved[name] as string; values[name] = input.value; }
    }
    for (const input of htmlForm.querySelectorAll<HTMLTextAreaElement>('details textarea')) if (typeof saved[input.name] === 'string') {
      input.value = saved[input.name] as string; values[input.name] = input.value; input.closest('details')!.open = Boolean(input.value);
    }
    status.textContent = 'Restored saved draft.';
  }
  root.host.addEventListener('gu-load-answers', event => {
    restore((event as CustomEvent<Answers>).detail); save(); status.textContent = 'Loaded saved response. Review and edit before generating a new comment.';
  });
  if (remember) void read<Answers | null>(key, null).then(saved => {
    if (!saved || changed || !root.host.isConnected) return;
    restore(saved);
  });
  // Flush on host cleanup as well as during ordinary typing.
  root.host.addEventListener('gu-dispose', () => {
    disposed = true; clearTimeout(timer);
    if (remember && changed) void write(key, values).catch(() => {});
  }, { once: true });
}

export function renderSnapshot(snapshot: Snapshot, repository: string): HTMLElement {
  const card = el('article', undefined, 'snapshot');
  card.append(el('span', snapshot.status.replaceAll('-', ' '), `badge status-${snapshot.status}`), el('h3', snapshot.title));
  if (snapshot.summary) card.append(markdown(snapshot.summary));
  card.append(el('p', `Task ${snapshot.task_id}${snapshot.session_id ? ` · Session ${snapshot.session_id}` : ''}`, 'muted'));
  const time = el('time', new Date(snapshot.updated_at).toLocaleString()); time.dateTime = snapshot.updated_at;
  const age = Date.now() - Date.parse(snapshot.updated_at);
  const freshness = el('p', undefined, 'muted'); freshness.append('Saved ', time, age > 5 * 60 * 1000 ? ' · last-known snapshot, not live' : ' · recently saved'); card.append(freshness);
  if (snapshot.formula || snapshot.gascity_version) card.append(el('p', [snapshot.formula && `Formula: ${snapshot.formula}`, snapshot.gascity_version && `Gas City ${snapshot.gascity_version}`].filter(Boolean).join(' · '), 'muted'));
  if (snapshot.head_sha) card.append(el('code', snapshot.head_sha.slice(0, 12)));
  const links = el('div', undefined, 'actions');
  for (const [type, label, value] of [['run', 'Workflow run ↗', snapshot.run_url], ['dashboard', 'Private dashboard ↗', snapshot.dashboard_url]] as const) {
    const href = safeLink(value, type, repository);
    if (href && !(type === 'dashboard' && snapshot.dashboard_status === 'offline')) {
      const a = el('a', label, 'link-button'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a);
    } else if (value) links.append(el('span', type === 'dashboard' ? 'Dashboard unavailable / offline' : 'Run link unavailable', 'muted'));
  }
  card.append(links);
  if (snapshot.beads.length) {
    const closed = snapshot.beads.filter(b => b.status === 'closed').length;
    card.append(el('p', `${closed} / ${snapshot.beads.length} beads complete`, 'progress-label'));
    const progress = el('progress'); progress.max = snapshot.beads.length; progress.value = closed; progress.setAttribute('aria-label', 'Bead completion'); card.append(progress);
    const list = el('ul', undefined, 'bead-list');
    for (const b of snapshot.beads) {
      const item = el('li'); item.append(el('span', b.status.replaceAll('_', ' '), `badge bead-${b.status}`), el('strong', b.title), el('code', b.id));
      if (b.dependencies?.length) item.append(el('small', `Depends on: ${b.dependencies.join(', ')}`, 'muted')); list.append(item);
    }
    card.append(list);
  }
  card.append(el('small', 'Comment-provided snapshot. Execution provenance must be verified by the future workflow handler.', 'muted'));
  return card;
}

export function renderResponse(response: ResponseRecord): HTMLElement {
  const card = el('article', undefined, 'snapshot');
  card.append(el('div', 'SAVED FORM RESPONSE', 'eyebrow'), el('h3', response.intent === 'discussion' ? 'Continue discussion · do not implement' : 'Approved for next steps'));
  card.append(el('p', `Form ${response.form_id} · Task ${response.task_id}`, 'muted'));
  if (response.session_id) card.append(el('p', `Continued session: ${response.session_id}`, 'muted'));
  const details = el('details'); details.append(el('summary', 'Submitted answers'));
  const pre = el('pre', JSON.stringify(response.answers, null, 2)); pre.className = 'answer-json'; details.append(pre); card.append(details);
  card.append(el('small', 'Comment-provided response; this does not prove a workflow ran or authorize execution by itself.', 'muted'));
  return card;
}

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { composeResponse, validateAnswers, omittedQuestions, safeLink, type TaskForm, type Answers, type Snapshot, type ResponseRecord } from './protocol';
import { answersMarkdown } from './comment-markdown';
import { isolateExtensionKeyboard } from './keyboard';
import { read } from './storage';
import { draftPersistence } from './draft';
import { choiceOptions, isOtherChoice } from './choices';
import css from './workspace.css?inline';
import { trackViewport, stabilizeZen } from './viewport';

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
  isolateExtensionKeyboard(); host.setAttribute('data-gu-root', '');
  const root = host.attachShadow({ mode: 'open' }); const style = el('style'); style.textContent = css; root.append(style); trackViewport(host); return root;
}
function commentButton(label: string): HTMLButtonElement {
  const toggle = button('Leave a comment', () => {}, 'note-toggle'); toggle.title = 'Leave a comment'; toggle.setAttribute('aria-label', label.replace(/^Add note/, 'Leave a comment')); toggle.setAttribute('aria-expanded', 'false');
  return toggle;
}
function notes(label: string, name: string, values: Answers): HTMLDivElement {
  const details = el('div', undefined, 'notes'); const toggle = commentButton(label);
  const input = el('textarea'); input.name = name; input.rows = 3; input.maxLength = 16000; input.setAttribute('aria-label', label);
  input.hidden = true;
  toggle.addEventListener('click', () => { input.hidden = !input.hidden; toggle.setAttribute('aria-expanded', String(!input.hidden)); if (!input.hidden) input.focus(); });
  input.addEventListener('input', () => { values[name] = input.value; toggle.classList.toggle('has-note', Boolean(input.value.trim())); });
  details.append(toggle, input); return details;
}
export type Source = { repository: string; number: number; comment_id: string; revision: string };

export async function copyText(value: string): Promise<void> {
  const focused = document.activeElement?.shadowRoot?.activeElement ?? document.activeElement;
  try { await navigator.clipboard.writeText(value); }
  catch {
    const field = el('textarea'); field.value = value; field.style.position = 'fixed'; field.style.top = '0'; field.style.fontSize = '16px';
    // A textarea outside an open modal is inert, so copy within the active dialog.
    const modal = [...document.querySelectorAll('[data-gu-root]')].map(host => host.shadowRoot?.querySelector('dialog[open]')).find(Boolean);
    (modal ?? document.body).append(field); field.focus(); field.select(); field.setSelectionRange(0, value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); }
    finally { field.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }); }
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
  input.focus({ preventScroll: true }); input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export type SavedSubmission = { record: ResponseRecord; url?: string };
export type FormController = { openZen: () => void; isComposingResponse: () => boolean; setResponses: (responses: SavedSubmission[]) => void; dispose: () => void };
let closeActiveZen: (() => void) | undefined;

export function renderRecordTools(openZen?: () => void, toggleOriginal?: () => void): HTMLElement {
  const tools = el('div', undefined, 'record-tools');
  if (openZen) tools.append(button('View in Zen Mode', openZen, 'zen-open'));
  if (toggleOriginal) tools.append(button('Show / hide original record', toggleOriginal, 'raw-toggle'));
  return tools;
}

export function renderForm(root: ShadowRoot, form: TaskForm, source: Source, isCurrent: () => boolean, remember: boolean, toggleOriginal?: () => void): FormController {
  const inline = el('div', undefined, 'inline-form'); root.append(inline);
  const card = el('section', undefined, 'form-card'); inline.append(card);
  const header = el('header', undefined, 'form-header'); const title = el('h2', form.title);
  const badge = el('span', form.invalidatedAt ? 'Superseded' : 'Needs input', 'badge form-state');
  header.append(title, badge); card.append(header);
  const editor = el('div', undefined, 'form-editor'); card.append(editor);
  if (form.goal) editor.append(markdown(`**Goal:** ${form.goal}`));
  if (form.description) { const detail = el('details'); detail.append(el('summary', 'Context'), markdown(form.description)); editor.append(detail); }
  if (form.session_id) editor.append(el('p', `Session ${form.session_id} · continued context`, 'muted'));
  const placeholder = el('p', 'This form is open in zen view.', 'notice'); placeholder.hidden = true; inline.append(placeholder);
  const dialog = el('dialog', undefined, 'zen-dialog'); dialog.setAttribute('aria-label', form.title); root.append(dialog);
  const dialogHeader = el('div', undefined, 'zen-header'); dialogHeader.append(el('span', 'Focused form', 'muted'));
  const zenBody = el('div', undefined, 'zen-body'); dialog.append(dialogHeader, zenBody);
  let previousFocus: HTMLElement | null = null;
  let stopZenViewport: (() => void) | undefined;
  function closeZen() {
    if (!dialog.open && card.parentElement !== zenBody) return;
    stopZenViewport?.(); stopZenViewport = undefined;
    if (dialog.open) dialog.close();
    inline.prepend(card); placeholder.hidden = true;
    if (closeActiveZen === closeZen) closeActiveZen = undefined;
    previousFocus?.focus({ preventScroll: true });
    previousFocus = null; window.dispatchEvent(new Event('gu-view-change'));
  }
  const close = button('Close zen', closeZen); dialogHeader.append(close);
  function openZen() {
    if (dialog.open || !root.host.isConnected) return;
    closeActiveZen?.(); previousFocus = (root.activeElement ?? document.activeElement) as HTMLElement | null;
    zenBody.append(card); placeholder.hidden = false; dialog.showModal(); stopZenViewport = stabilizeZen(dialog); closeActiveZen = closeZen; close.focus(); window.dispatchEvent(new Event('gu-view-change'));
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeZen(); });
  dialog.addEventListener('close', () => { if (!dialog.open && card.parentElement === zenBody) closeZen(); });
  root.host.addEventListener('gu-key', event => {
    const key = (event as CustomEvent<KeyboardEvent>).detail;
    if (!dialog.open || key.type !== 'keydown' || key.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')].filter(node => node.tabIndex >= 0 && !node.hasAttribute('disabled') && node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (!first || !last) return;
    if ((key.shiftKey && root.activeElement === first) || (!key.shiftKey && root.activeElement === last) || !dialog.contains(root.activeElement)) {
      key.preventDefault(); (key.shiftKey ? last : first).focus();
    }
  });
  const standaloneTools = renderRecordTools(openZen, toggleOriginal); card.insertBefore(standaloneTools, editor);
  const controller: FormController = { openZen, isComposingResponse: () => false, setResponses: () => {}, dispose: closeZen };
  root.host.addEventListener('gu-dispose', () => controller.dispose(), { once: true });
  if (form.invalidatedAt) { editor.append(el('p', `This form was superseded. ${form.invalidatedReason ?? ''}`, 'notice')); return controller; }
  const values: Answers = {};
  const htmlForm = el('form'); htmlForm.noValidate = true; editor.append(htmlForm);
  const status = el('p', '', 'draft-error error'); status.setAttribute('role', 'alert');
  const errors = el('div', undefined, 'error'); errors.setAttribute('role', 'alert');
  const key = `draft:${source.repository}:${source.number}:${source.comment_id}:${form.id}:${source.revision}`;
  let step = 0;
  let composing = false;
  const draft = draftPersistence(key, remember, () => ({ values, step }), message => {
    if (status.textContent !== message) status.textContent = message;
  });
  const save = () => draft.change(composing);
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const fields = new Map<string, HTMLFieldSetElement>();
  for (const q of form.questions) {
    const fieldset = el('fieldset'); fieldset.append(el('legend', q.title), markdown(q.description));
    fields.set(q.id, fieldset);
    if (q.type === 'choices') {
      const choices = choiceOptions(form, q);
      values[q.id] = Object.fromEntries(choices.map(c => [c.id, false]));
      const grouped = new Set((q.choiceGroups ?? []).flatMap(g => g.choiceIds));
      const choiceNodes = new Map<string, HTMLElement>();
      for (const c of choices) {
        const row = el('div', undefined, 'choice'); const label = el('label', undefined, 'choice-label'); const input = el('input');
        input.type = 'checkbox'; input.name = q.id; input.value = c.id;
        controls.set(`${q.id}:${c.id}`, input);
        input.addEventListener('change', () => {
          (values[q.id] as Record<string, boolean>)[c.id] = input.checked;
        });
        label.append(input, el('span', c.label)); row.append(label);
        if (c.assumedTrue) row.append(el('span', 'Author assumption · not preselected', 'badge'));
        if (c.description) row.append(markdown(c.description));
        if (c.is_recommended_reason) row.append(el('p', `Recommended · ${c.is_recommended_reason}`, 'recommended'));
        if (c.prosAndCons) for (const [kind, items] of Object.entries(c.prosAndCons)) if (items?.length) row.append(markdown(`**${kind === 'pros' ? 'Pros' : 'Cons'}**\n${items.map(s => `- ${s}`).join('\n')}`));
        const note = notes(`Add note about ${c.label}`, `${q.id}_${c.id}_more_info`, values);
        if (isOtherChoice(c)) {
          note.querySelector('textarea')!.placeholder = 'Describe your other option';
          input.addEventListener('change', () => {
            if (input.checked) { note.querySelector('textarea')!.hidden = false; note.querySelector('button')!.setAttribute('aria-expanded', 'true'); }
          });
        }
        row.append(note); choiceNodes.set(c.id, row);
      }
      for (const g of q.choiceGroups ?? []) {
        const block = el('section', undefined, 'choice-group'); if (g.title) block.append(el('h4', g.title));
        if (g.description) block.append(markdown(g.description));
        if (g.mode !== 'any') block.append(el('p', 'The author suggests one option; you may select several or choose Other.', 'muted'));
        for (const name of g.choiceIds) block.append(choiceNodes.get(name)!); fieldset.append(block);
      }
      for (const c of choices) if (!grouped.has(c.id)) fieldset.append(choiceNodes.get(c.id)!);
    } else {
      const input = q.type === 'text' ? el('input') : el('textarea');
      input.name = q.id; input.setAttribute('aria-label', q.title); input.placeholder = q.placeholder ?? ''; input.maxLength = 16000;
      if (input instanceof HTMLTextAreaElement) input.rows = 5;
      controls.set(q.id, input); input.addEventListener('input', () => { values[q.id] = input.value; }); fieldset.append(input);
    }
    if (q.required) fieldset.append(el('small', 'Answer requested · you may skip if it no longer applies', 'muted'));
    if (q.id !== 'additional_notes') fieldset.append(notes(`Add note for ${q.title}`, `${q.id}_more_info`, values));
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
  next.append(presets, nextInput);
  const submissionControls = el('section', undefined, 'submission-controls'); submissionControls.append(next); htmlForm.append(submissionControls);
  const actions = el('div', undefined, 'actions');
  const config = typeof form.allowCodeFileChanges === 'object' ? form.allowCodeFileChanges : undefined;
  const preview = el('section', undefined, 'preview'); preview.hidden = true;
  controller.isComposingResponse = () => !preview.hidden;
  const viewChanged = () => window.dispatchEvent(new Event('gu-view-change'));
  const previewText = el('textarea'); previewText.readOnly = true; previewText.rows = 12; previewText.setAttribute('aria-label', 'Generated comment preview');
  const previewStatus = el('p'); previewStatus.setAttribute('role', 'status');
  function prepare(approved: boolean) {
    errors.replaceChildren();
    if (!isCurrent()) { errors.textContent = 'The source form changed or is no longer on this page. Refresh before answering.'; return; }
    const problems = validateAnswers(form, values, { allowUnanswered: true }); if (problems.length) { errors.textContent = problems.join('\n'); return; }
    try {
      previewText.value = composeResponse(form, values, source, approved, { allowUnanswered: true }); preview.hidden = false;
      previewStatus.textContent = approved ? 'Approved next steps. Review the command, then place it in GitHub’s editor.' : 'Discussion only. This command explicitly disallows implementation.';
      viewChanged();
      preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errors.textContent = String(e); }
  }
  if (form.allowCodeFileChanges !== false) actions.append(button(config?.allowLabel ?? config?.label ?? 'Approved for next steps', () => prepare(true), 'primary'));
  actions.append(button(config?.avoidLabel ?? 'Continue discussion — don’t implement yet', () => prepare(false)));
  htmlForm.addEventListener('submit', event => { event.preventDefault(); prepare(false); });
  submissionControls.append(errors, markdown(config?.description), actions); htmlForm.append(status);
  preview.append(el('h3', 'Review your comment'), previewStatus, previewText);
  const previewActions = el('div', undefined, 'actions');
  previewActions.append(button('Place in GitHub comment editor', () => {
    if (!isCurrent()) { previewStatus.textContent = 'Source changed. Refresh and review again.'; return; }
    try { closeZen(); insertComment(previewText.value); previewStatus.textContent = 'Draft inserted. Click GitHub’s Comment button to submit. This is not submitted until the response is posted.'; }
    catch (e) { previewStatus.textContent = (e as Error).message; }
  }, 'primary'), button('Copy comment', () => { void copyText(previewText.value).then(() => { previewStatus.textContent = 'Copied.'; }).catch(e => { previewStatus.textContent = e.message; }); }), button('Close preview', () => { preview.hidden = true; viewChanged(); }));
  preview.append(previewActions); editor.append(preview);
  const questions = form.questions.filter(q => q.id !== 'additional_notes');
  const wizard = questions.length > 1;
  const nav = el('nav', undefined, 'question-index'); nav.setAttribute('aria-label', 'Form questions');
  const progress = el('p', '', 'wizard-progress'); progress.setAttribute('aria-live', 'polite');
  const review = el('section', undefined, 'answer-review'); review.append(el('h3', 'Review answers'));
  review.hidden = true;
  const stepButtons: HTMLButtonElement[] = [];
  const navigation: Array<{ previous: HTMLButtonElement; next: HTMLButtonElement }> = [];
  function goTo(index: number) {
    step = Math.max(0, Math.min(index, questions.length)); renderStep(); save(); viewChanged();
    questionStart.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  function navigationRow(includeTools = false) {
    const row = el('div', undefined, 'wizard-navigation');
    const previous = button('Previous', () => goTo(step - 1));
    const next = button('Next', () => goTo(step + 1), 'primary');
    row.append(previous, renderRecordTools(includeTools ? openZen : undefined, includeTools ? toggleOriginal : undefined), next); navigation.push({ previous, next }); return row;
  }
  const headerSteps = el('div', undefined, 'wizard-header');
  const questionStart = el('div', undefined, 'wizard-anchor'); questionStart.setAttribute('aria-hidden', 'true');
  if (wizard) {
    standaloneTools.hidden = true;
    questions.forEach((q, index) => { const b = button(`${index + 1}. ${q.title}`, () => goTo(index)); stepButtons.push(b); nav.append(b); });
    const b = button('Review answers', () => goTo(questions.length)); stepButtons.push(b); nav.append(b);
    for (const tab of stepButtons) tab.title = tab.textContent!;
    headerSteps.append(nav, progress, navigationRow(true)); htmlForm.prepend(questionStart, headerSteps);
    htmlForm.insertBefore(review, submissionControls); htmlForm.append(navigationRow());
  }
  function renderStep() {
    if (!wizard) return;
    questions.forEach((q, index) => { fields.get(q.id)!.hidden = index !== step; });
    stepButtons.forEach((b, index) => b.setAttribute('aria-current', index === step ? 'step' : 'false'));
    const reviewing = step === questions.length;
    progress.textContent = reviewing ? `Review · ${questions.length} questions` : `Question ${step + 1} of ${questions.length}`;
    submissionControls.hidden = !reviewing; review.hidden = !reviewing; preview.hidden = true;
    for (const pair of navigation) { pair.previous.disabled = step === 0; pair.next.hidden = reviewing; pair.next.textContent = step === questions.length - 1 ? 'Review answers' : 'Next'; }
    if (reviewing) {
      review.replaceChildren(el('h3', 'Review answers'));
      const omitted = omittedQuestions(form, values);
      if (omitted.length) review.append(el('p', `${omitted.length} requested question${omitted.length === 1 ? ' is' : 's are'} unanswered. You may still submit if they no longer apply; omissions are recorded.`, 'notice'));
      for (const q of form.questions) {
        const section = el('section', undefined, 'review-item');
        section.append(markdown(answersMarkdown(form, values, q.id)));
        section.append(button(`Revisit ${q.title}`, () => {
          if (q.id === 'additional_notes') fields.get(q.id)?.querySelector('textarea')?.focus(); else goTo(questions.findIndex(item => item.id === q.id));
        })); review.append(section);
      }
    }
  }
  renderStep();
  const summary = el('section', undefined, 'submitted-summary'); summary.hidden = true; card.insertBefore(summary, editor);
  let responseSignature = '';
  controller.setResponses = responses => {
    const signature = JSON.stringify(responses);
    if (signature === responseSignature) return; responseSignature = signature;
    summary.replaceChildren();
    const submitted = responses.length > 0;
    standaloneTools.hidden = wizard && !submitted;
    card.dataset.state = submitted ? 'submitted' : 'pending'; summary.hidden = !submitted; editor.hidden = submitted;
    badge.textContent = submitted ? 'Submitted' : 'Needs input';
    if (!submitted) return;
    closeZen();
    const latest = responses.at(-1)!.record;
    summary.append(el('p', `${latest.intent === 'discussion' ? 'Discussion only' : 'Approved for next steps'} · ${responses.length} immutable response${responses.length === 1 ? '' : 's'}`, 'muted'));
    const answers = el('section', undefined, 'saved-answers'); answers.hidden = true;
    for (const [index, entry] of [...responses].reverse().entries()) {
      const section = el('section', undefined, 'review-item'); section.append(el('h3', `Response ${responses.length - index} · ${entry.record.intent === 'discussion' ? 'Discussion' : 'Approved next steps'}`), markdown(answersMarkdown(form, entry.record.answers)));
      if (entry.url) { const link = el('a', 'Open posted response'); link.href = entry.url; section.append(link); }
      answers.append(section);
    }
    const view = button('View submitted answers', () => { answers.hidden = !answers.hidden; view.setAttribute('aria-expanded', String(!answers.hidden)); view.textContent = answers.hidden ? 'View submitted answers' : 'Hide submitted answers'; }); view.setAttribute('aria-expanded', 'false');
    summary.append(view, button('Submit another response', () => {
      standaloneTools.hidden = wizard;
      editor.hidden = false; summary.hidden = true; badge.textContent = 'New response';
      // Starting a new submission never edits a posted response or its ID.
      for (const name of Object.keys(values)) delete values[name];
      for (const q of form.questions) if (q.type === 'choices') values[q.id] = Object.fromEntries(choiceOptions(form, q).map(c => [c.id, false]));
      for (const input of htmlForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) { if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = false; else input.value = ''; }
      for (const note of htmlForm.querySelectorAll<HTMLElement>('.notes')) {
        note.querySelector('textarea')!.hidden = true;
        const toggle = note.querySelector('button')!; toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('has-note');
      }
      step = 0; preview.hidden = true; renderStep(); save(); viewChanged();
    }), answers);
  };
  htmlForm.addEventListener('input', save); htmlForm.addEventListener('change', save);
  htmlForm.addEventListener('compositionstart', () => { composing = true; draft.change(true); });
  htmlForm.addEventListener('compositionend', () => { composing = false; save(); });
  function restore(saved: Answers) {
    // Restore only declared form fields; stored drafts are never interpreted as HTML.
    for (const [name, input] of controls) {
      const [qid, cid] = name.split(':');
      if (cid && input instanceof HTMLInputElement) {
        const choice = saved[qid]; const checked = choice && typeof choice === 'object' && choice[cid] === true;
        input.checked = Boolean(checked); (values[qid] as Record<string, boolean>)[cid] = Boolean(checked);
      } else if (typeof saved[name] === 'string') { input.value = saved[name] as string; values[name] = input.value; }
    }
    for (const input of htmlForm.querySelectorAll<HTMLTextAreaElement>('.notes textarea')) if (typeof saved[input.name] === 'string') {
      input.value = saved[input.name] as string; values[input.name] = input.value; input.hidden = !input.value;
      const toggle = input.parentElement!.querySelector('button')!; toggle.setAttribute('aria-expanded', String(!input.hidden)); toggle.classList.toggle('has-note', Boolean(input.value));
    }
    for (const q of form.questions) if (q.type === 'choices') for (const c of choiceOptions(form, q)) {
      if (!isOtherChoice(c) || !(controls.get(`${q.id}:${c.id}`) as HTMLInputElement).checked) continue;
      const input = htmlForm.querySelector<HTMLTextAreaElement>(`textarea[name="${q.id}_${c.id}_more_info"]`)!;
      input.hidden = false; input.parentElement!.querySelector('button')!.setAttribute('aria-expanded', 'true');
    }
  }
  if (remember) void read<Record<string, unknown> | null>(key, null).then(saved => {
    if (!saved || draft.changed || !root.host.isConnected) return;
    restore((saved.values && typeof saved.values === 'object' ? saved.values : saved) as Answers);
    if (typeof saved.step === 'number') step = Math.max(0, Math.min(saved.step, questions.length));
    renderStep();
  });
  controller.dispose = () => {
    closeZen();
    draft.dispose();
  };
  return controller;
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
  card.append(el('div', 'Saved form response', 'eyebrow'), el('h3', response.intent === 'discussion' ? 'Continue discussion · do not implement' : 'Approved for next steps'));
  card.append(el('p', `Form ${response.form_id} · Task ${response.task_id}`, 'muted'));
  if (response.session_id) card.append(el('p', `Continued session: ${response.session_id}`, 'muted'));
  const details = el('details'); details.append(el('summary', 'Submitted answers'));
  const pre = el('pre', JSON.stringify(response.answers, null, 2)); pre.className = 'answer-json'; details.append(pre); card.append(details);
  card.append(el('small', 'Comment-provided response; this does not prove a workflow ran or authorize execution by itself.', 'muted'));
  return card;
}

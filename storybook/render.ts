import { el, button, shadow, renderForm, renderRecordTools, renderSnapshot, renderResponse, type FormController } from '../src/ui';
import { parseRecord, revisionOf, type Answers, type ResponseRecord } from '../src/protocol';
import { response, source } from './fixtures';
import { githubEnvironment, type GitHubOptions } from './github';

export type StoryArgs = GitHubOptions & {
  source: string | object;
  theme: 'light' | 'dark';
  width: 'fluid' | 'phone' | 'sidebar';
  stage: 'edit' | 'question-two' | 'review' | 'preview' | 'zen' | 'submitted' | 'history' | 'new-response';
  seed?: Answers;
  storageFailure?: boolean;
};
export const baseArgs = { theme: 'light', width: 'fluid', stage: 'edit', layout: 'github', thread: 'pull', conversation: 'short' } as const;
export const controls = {
  source: { name: 'Raw JSON', control: 'object', description: 'Expand the record or toggle “Edit source as JSON” to view/edit raw JSON. This is the record rendered in the story; YAML and malformed-source examples retain their original text.' },
  theme: { control: 'inline-radio', options: ['light', 'dark'] },
  width: { control: 'inline-radio', options: ['fluid', 'phone', 'sidebar'] },
  stage: { control: 'select', options: ['edit', 'question-two', 'review', 'preview', 'zen', 'submitted', 'history', 'new-response'] },
  seed: { control: 'object' },
  storageFailure: { control: 'boolean' },
  layout: { control: 'inline-radio', options: ['github', 'isolated'] },
  thread: { control: 'inline-radio', options: ['pull', 'issue'] },
  conversation: { control: 'inline-radio', options: ['short', 'long'] },
  workspaceOpen: { control: 'boolean' },
} as const;

let disposeCurrent: (() => void) | undefined;

export function renderRecord(args: StoryArgs): HTMLElement {
  disposeCurrent?.();
  const environment = githubEnvironment(args);
  const { frame, recordBody, editor, receipt } = environment;
  const host = el('div'); host.dataset.theme = args.theme; host.dataset.storyRenderer = '';
  recordBody.append(host); const root = shadow(host);
  let disposed = false;
  const postedHosts: HTMLElement[] = [];
  disposeCurrent = () => {
    disposed = true; host.dispatchEvent(new Event('gu-dispose')); environment.dispose();
    for (const entry of postedHosts) entry.dispatchEvent(new Event('gu-dispose'));
  };
  let controller: FormController | undefined;
  const posted: { record: ResponseRecord }[] = [];
  function appendResponse(record: ResponseRecord) {
    const responseHost = el('div'); responseHost.dataset.theme = args.theme;
    shadow(responseHost).append(renderResponse(record)); postedHosts.push(responseHost);
    environment.appendPosted(responseHost);
  }
  environment.setPost(() => {
    try {
      if (!editor.value.trim()) throw new Error('Write a comment before posting.');
      const match = /```github-response\s*\n([\s\S]*?)\n```/.exec(editor.value);
      if (!match) {
        environment.appendNativePosted(editor.value); environment.resetEditor();
        receipt.textContent = 'Simulated ordinary comment. Nothing was sent to GitHub.'; return;
      }
      const record = parseRecord(match[1]);
      if (!('kind' in record) || record.kind !== 'response' || record.source.revision !== revision || record.form_id !== formId) throw new Error('The response does not match this story form.');
      posted.push({ record }); controller?.setResponses(posted);
      appendResponse(record); environment.setPosted(posted.length);
      receipt.textContent = `Simulated posted response ${posted.length}. Nothing was sent to GitHub.`;
      environment.resetEditor();
    } catch (error) { receipt.textContent = (error as Error).message; }
  });
  let revision = '', formId = '';
  void (async () => {
    let raw = '';
    try {
      raw = typeof args.source === 'string' ? args.source : JSON.stringify(args.source, null, 2) ?? '';
      const data = parseRecord(raw);
      revision = await revisionOf(raw);
      if (disposed || !host.isConnected) return;
      const original = el('pre', raw, 'gh-source-data'); original.hidden = true;
      const toggleOriginal = () => { original.hidden = !original.hidden; };
      if ('format' in data) {
        formId = data.id;
        controller = renderForm(root, data, { ...source, revision }, () => !disposed, Boolean(args.storageFailure), toggleOriginal);
        environment.setForm(data.title, Boolean(data.invalidatedAt), controller.openZen, controller.isComposingResponse);
        for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
          const value = args.seed?.[input.name];
          if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            if (value && typeof value === 'object') { input.checked = value[input.value] === true; input.dispatchEvent(new Event('change', { bubbles: true })); }
          } else if (typeof value === 'string') {
            input.value = value;
            if (input.closest('.notes')) { input.hidden = false; input.parentElement!.querySelector('button')!.setAttribute('aria-expanded', 'true'); }
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        const click = (text: string) => [...root.querySelectorAll('button')].find(node => node.textContent === text)?.click();
        if (['submitted', 'history', 'new-response'].includes(args.stage)) {
          const entry = { ...response(args.seed), source: { ...source, revision }, form_id: data.id };
          posted.push({ record: entry });
          if (args.stage === 'history') posted.push({ record: { ...response(args.seed, true, 2), source: { ...source, revision }, form_id: data.id } });
          controller.setResponses(posted);
          for (const entry of posted) appendResponse(entry.record);
          environment.setPosted(posted.length);
          if (args.stage === 'new-response') click('Submit another response');
        }
        if (args.stage === 'question-two') root.querySelectorAll<HTMLButtonElement>('.question-index button')[1]?.click();
        if (['review', 'preview'].includes(args.stage)) click('Review answers');
        if (args.stage === 'preview') click('Continue discussion — don’t implement yet');
        if (args.stage === 'zen') controller.openZen();
      } else if (data.kind === 'workflow') root.append(renderSnapshot(data, source.repository));
      else root.append(renderResponse(data));
      recordBody.append(original);
      if (!('format' in data)) root.append(renderRecordTools(undefined, toggleOriginal));
    } catch (error) {
      if (disposed) return;
      const message = el('p', `Invalid record: ${(error as Error).message}`, 'error'); message.setAttribute('role', 'alert');
      root.append(message, el('pre', raw, 'answer-json'));
    }
  })();
  return frame;
}

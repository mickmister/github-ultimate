import { el, button, shadow, renderForm, renderSnapshot, renderResponse, type FormController } from '../src/ui';
import { parseRecord, revisionOf, type Answers, type ResponseRecord } from '../src/protocol';
import { response, source } from './fixtures';

export type StoryArgs = {
  source: string;
  theme: 'light' | 'dark';
  width: 'fluid' | 'phone' | 'sidebar';
  stage: 'edit' | 'question-two' | 'review' | 'preview' | 'zen' | 'submitted' | 'history' | 'new-response';
  seed?: Answers;
  storageFailure?: boolean;
};
export const baseArgs = { theme: 'light', width: 'fluid', stage: 'edit' } as const;
export const controls = {
  source: { control: 'text' },
  theme: { control: 'inline-radio', options: ['light', 'dark'] },
  width: { control: 'inline-radio', options: ['fluid', 'phone', 'sidebar'] },
  stage: { control: 'select', options: ['edit', 'question-two', 'review', 'preview', 'zen', 'submitted', 'history', 'new-response'] },
  seed: { control: 'object' },
  storageFailure: { control: 'boolean' },
} as const;

let disposeCurrent: (() => void) | undefined;

export function renderRecord(args: StoryArgs): HTMLElement {
  disposeCurrent?.();
  const frame = el('section'); frame.setAttribute('aria-label', 'Story canvas');
  frame.style.cssText = `max-width:${args.width === 'phone' ? '390px' : args.width === 'sidebar' ? '480px' : '960px'};margin:0 auto;padding:20px;background:${args.theme === 'dark' ? '#17121b' : '#fff'};color:${args.theme === 'dark' ? '#f0e8e5' : '#1f2328'};font:14px/1.6 system-ui;box-sizing:border-box;`;
  const caption = el('p', 'Interactive fixture · shipping extension renderer · no GitHub requests or agent execution'); frame.append(caption);
  const host = el('div'); host.dataset.theme = args.theme; host.dataset.storyRenderer = '';
  frame.append(host); const root = shadow(host);
  let disposed = false;
  disposeCurrent = () => { disposed = true; host.dispatchEvent(new Event('gu-dispose')); };
  const native = el('form'); native.setAttribute('aria-label', 'Local comment composer');
  native.style.cssText = 'margin-top:24px;border-top:1px solid #888;padding-top:12px';
  const label = el('label', 'Local GitHub comment editor (demo only)');
  const editor = el('textarea'); editor.id = 'new_comment_field'; editor.name = 'comment[body]'; editor.rows = 8;
  editor.setAttribute('aria-label', 'Local GitHub comment editor'); editor.value = 'My existing native comment draft.';
  editor.style.cssText = 'display:block;width:100%;box-sizing:border-box;font:16px/1.5 monospace';
  label.append(editor); native.append(label);
  const receipt = el('p'); receipt.setAttribute('role', 'status');
  let controller: FormController | undefined;
  const posted: { record: ResponseRecord }[] = [];
  native.append(button('Simulate posting locally', () => {
    try {
      const match = /```github-response\s*\n([\s\S]*?)\n```/.exec(editor.value);
      if (!match) throw new Error('Generate a response and place it in this editor first.');
      const record = parseRecord(match[1]);
      if (!('kind' in record) || record.kind !== 'response' || record.source.revision !== revision || record.form_id !== formId) throw new Error('The response does not match this story form.');
      posted.push({ record }); controller?.setResponses(posted);
      receipt.textContent = `Simulated posted response ${posted.length}. Nothing was sent to GitHub.`;
      editor.value = '';
    } catch (error) { receipt.textContent = (error as Error).message; }
  }), receipt);
  native.addEventListener('submit', event => event.preventDefault());
  let revision = '', formId = '';
  void (async () => {
    try {
      const data = parseRecord(args.source);
      revision = await revisionOf(args.source);
      if (disposed || !host.isConnected) return;
      if ('format' in data) {
        formId = data.id;
        controller = renderForm(root, data, { ...source, revision }, () => !disposed, Boolean(args.storageFailure));
        if (!data.invalidatedAt) frame.append(native);
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
          if (args.stage === 'new-response') click('Submit another response');
        }
        if (args.stage === 'question-two') root.querySelectorAll<HTMLButtonElement>('.question-index button')[1]?.click();
        if (['review', 'preview'].includes(args.stage)) click('Review answers');
        if (args.stage === 'preview') click('Continue discussion — don’t implement yet');
        if (args.stage === 'zen') controller.openZen();
      } else if (data.kind === 'workflow') root.append(renderSnapshot(data, source.repository));
      else root.append(renderResponse(data));
    } catch (error) {
      if (disposed) return;
      const message = el('p', `Invalid record: ${(error as Error).message}`, 'error'); message.setAttribute('role', 'alert');
      root.append(message, el('pre', args.source, 'answer-json'));
    }
  })();
  return frame;
}

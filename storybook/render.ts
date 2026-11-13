import { el, button, shadow, renderForm, renderRecordTools, renderSnapshot, renderResponse, type FormController } from '../src/ui';
import { parseRecord, revisionOf, type Answers, type ResponseRecord } from '../src/protocol';
import { response, source } from './fixtures';
import { githubEnvironment, type GitHubOptions } from './github';
import { defaults, type Settings } from '../src/storage';

export type StoryArgs = GitHubOptions & {
  source: string | object;
  additionalSources?: Array<string | object>;
  theme: 'light' | 'dark';
  width: 'fluid' | 'phone' | 'sidebar';
  stage: 'edit' | 'question-two' | 'review' | 'preview' | 'zen' | 'submitted' | 'history' | 'new-response';
  seed?: Answers;
  storageFailure?: boolean;
  showDiagnosticJson?: Settings['showDiagnosticJson'];
};
export const baseArgs = { theme: 'light', width: 'fluid', stage: 'edit', layout: 'github', thread: 'pull', conversation: 'short', showDiagnosticJson: defaults.showDiagnosticJson } as const;
export const controls = {
  source: { name: 'Raw JSON', control: 'object', description: 'Expand the record or toggle “Edit source as JSON” to view/edit raw JSON. This is the record rendered in the story; YAML and malformed-source examples retain their original text.' },
  additionalSources: { control: 'object', description: 'Additional records rendered in separate comments in the same conversation.' },
  theme: { control: 'inline-radio', options: ['light', 'dark'] },
  width: { control: 'inline-radio', options: ['fluid', 'phone', 'sidebar'] },
  stage: { control: 'select', options: ['edit', 'question-two', 'review', 'preview', 'zen', 'submitted', 'history', 'new-response'] },
  seed: { control: 'object' },
  storageFailure: { control: 'boolean' },
  showDiagnosticJson: { name: 'Show original record button', control: 'boolean', description: 'Mirrors the extension’s showDiagnosticJson setting. Enables the “Show / hide original record” button; off by default.' },
  layout: { control: 'inline-radio', options: ['github', 'isolated'] },
  thread: { control: 'inline-radio', options: ['pull', 'issue'] },
  conversation: { control: 'inline-radio', options: ['short', 'long'] },
  workspaceOpen: { control: 'boolean' },
} as const;

let disposeCurrent: (() => void) | undefined;

export function renderRecord(args: StoryArgs): HTMLElement {
  disposeCurrent?.();
  const sources = [args.source, ...args.additionalSources ?? []];
  const environment = githubEnvironment({ ...args, recordCount: sources.length });
  const { frame, recordBodies, editor, receipt } = environment;
  const hosts: HTMLElement[] = [];
  let disposed = false;
  const postedHosts: HTMLElement[] = [];
  disposeCurrent = () => {
    disposed = true; for (const host of hosts) host.dispatchEvent(new Event('gu-dispose')); environment.dispose();
    for (const entry of postedHosts) entry.dispatchEvent(new Event('gu-dispose'));
  };
  const records: Array<{ revision: string; formId: string; commentId: string; index: number; controller?: FormController; posted: { record: ResponseRecord }[] }> = [];
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
      if (!('kind' in record) || record.kind !== 'response') throw new Error('The response does not match this story form.');
      const target = records.find(item => item.revision === record.source.revision && item.formId === record.form_id && item.commentId === record.source.comment_id);
      if (!target) throw new Error('The response does not match this story form.');
      target.posted.push({ record }); target.controller?.setResponses(target.posted);
      appendResponse(record); environment.setPosted(target.posted.length, target.index);
      receipt.textContent = `Simulated posted response ${target.posted.length}. Nothing was sent to GitHub.`;
      environment.resetEditor();
    } catch (error) { receipt.textContent = (error as Error).message; }
  });
  sources.forEach((value, index) => {
    const recordBody = recordBodies[index];
    const host = el('div'); host.dataset.theme = args.theme; host.dataset.storyRenderer = '';
    hosts.push(host); recordBody.append(host); const root = shadow(host);
    const recordSource = { ...source, comment_id: index ? `${source.comment_id}-${index + 1}` : source.comment_id };
    const state: typeof records[number] = { revision: '', formId: '', commentId: recordSource.comment_id, index, posted: [] }; records.push(state);
    const posted = state.posted;
    void (async () => {
      let raw = '';
      try {
        raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
        const data = parseRecord(raw);
        const revision = await revisionOf(raw); state.revision = revision;
        if (disposed || !host.isConnected) return;
        const original = el('pre', raw, 'gh-source-data'); original.hidden = true;
        const toggleOriginal = args.showDiagnosticJson ? () => { original.hidden = !original.hidden; } : undefined;
        if ('format' in data) {
          state.formId = data.id;
          const controller = renderForm(root, data, { ...recordSource, revision }, () => !disposed, Boolean(args.storageFailure), toggleOriginal); state.controller = controller;
          environment.setForm(data.title, Boolean(data.invalidatedAt), controller.openZen, controller.isComposingResponse, index);
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
            const entry = { ...response(args.seed), source: { ...recordSource, revision }, form_id: data.id };
            posted.push({ record: entry });
            if (args.stage === 'history') posted.push({ record: { ...response(args.seed, true, 2), source: { ...recordSource, revision }, form_id: data.id } });
            controller.setResponses(posted);
            for (const entry of posted) appendResponse(entry.record);
            environment.setPosted(posted.length, index);
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
  });
  return frame;
}

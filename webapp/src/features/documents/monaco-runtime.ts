import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/language/json/monaco.contribution.js';
import { documentLanguage } from './document-format';
import { registerFeedbackSelection } from '../feedback/selection';
import { registerFeedbackAnnotations } from '../feedback/annotation-adapter';
import type { FeedbackComment } from '../feedback/contracts';

// Vite emits same-origin workers alongside the app/Storybook assets. No CDN.
globalThis.MonacoEnvironment = {
  getWorker(_id, label) { return label === 'json' ? new JsonWorker() : new EditorWorker(); },
};

export function mountDocumentDiff(host: HTMLElement, path: string, before: string, after: string): () => void {
  const original = monaco.editor.createModel(before, documentLanguage(path));
  const modified = monaco.editor.createModel(after, documentLanguage(path));
  const editor = monaco.editor.createDiffEditor(host, {
    readOnly: true, domReadOnly: true, originalEditable: false, automaticLayout: true,
    renderSideBySide: false, minimap: { enabled: false }, wordWrap: 'on',
    accessibilitySupport: 'on', ariaLabel: 'Pinned document changes',
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
  });
  editor.setModel({ original, modified });
  return () => { editor.dispose(); original.dispose(); modified.dispose(); };
}

export function mountDocumentEditor(host: HTMLElement, path: string, content: string): () => void {
  const model = monaco.editor.createModel(content, documentLanguage(path));
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const editor = monaco.editor.create(host, {
    model, readOnly: true, domReadOnly: true, contextmenu: false,
    ariaLabel: 'Read-only document source', accessibilitySupport: 'on',
    automaticLayout: true, minimap: { enabled: false }, wordWrap: 'on',
    scrollBeyondLastLine: false, fontSize: 14, padding: { top: 16, bottom: 16 },
    theme: dark.matches ? 'vs-dark' : 'vs',
    renderValidationDecorations: 'off', links: false,
  });
  const theme = () => monaco.editor.setTheme(dark.matches ? 'vs-dark' : 'vs');
  const unregisterSelection = registerFeedbackSelection(host, () => {
    const selections = editor.getSelections()?.filter(selection => !selection.isEmpty()) ?? [];
    if (!selections.length) return null;
    return { text: selections.map(selection => model.getValueInRange(selection)).join('\n'), representation: 'source', ranges: selections.map(selection => ({
      startLineNumber: selection.startLineNumber, startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber, endColumn: selection.endColumn,
    })) };
  });
  const decorations = editor.createDecorationsCollection();
  let annotations: { item: FeedbackComment; ranges: monaco.Range[] }[] = [];
  let activate = (_id: string) => {};
  function sourceRanges(item: FeedbackComment) {
    const selection = item.context.selection;
    if (model.isDisposed() || selection?.representation !== 'source' || !Array.isArray(selection.ranges) || !selection.ranges.length) return null;
    const ranges = [];
    for (const value of selection.ranges) {
      if (!value || ![value.startLineNumber, value.startColumn, value.endLineNumber, value.endColumn].every(number => Number.isSafeInteger(number) && number > 0)) return null;
      const range = model.validateRange(value);
      if (!range.equalsRange(value)) return null;
      ranges.push(range);
    }
    return ranges.map(range => model.getValueInRange(range)).join('\n') === selection.text ? ranges : null;
  }
  const unregisterAnnotations = registerFeedbackAnnotations(host, {
    set(comments, activeId, onActivate) {
      if (model.isDisposed()) return;
      activate = onActivate;
      annotations = comments.flatMap(item => { const ranges = sourceRanges(item); return ranges ? [{ item, ranges }] : []; });
      decorations.set(annotations.flatMap(({ item, ranges }) => ranges.map(range => ({ range, options: {
        description: 'Queued feedback comment', inlineClassName: `feedback-source-highlight${activeId === item.id ? ' is-active' : ''}`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        overviewRuler: { color: '#d39d2e', position: monaco.editor.OverviewRulerLane.Right },
      } }))));
    },
    top(item) {
      const range = annotations.find(value => value.item.id === item.id)?.ranges[0];
      return range && !model.isDisposed() ? editor.getTopForPosition(range.startLineNumber, range.startColumn) - editor.getScrollTop() : null;
    },
    reveal(item) { const range = annotations.find(value => value.item.id === item.id)?.ranges[0]; if (range && !model.isDisposed()) editor.revealRangeInCenter(range); },
    subscribe(measure) {
      const scroll = editor.onDidScrollChange(measure), layout = editor.onDidLayoutChange(measure);
      return () => { scroll.dispose(); layout.dispose(); };
    },
    clear() { annotations = []; if (!model.isDisposed()) decorations.clear(); },
  });
  const annotationClick = editor.onMouseUp(event => {
    if (!event.target.position || !editor.getSelection()?.isEmpty()) return;
    const comment = annotations.find(value => value.ranges.some(range => range.containsPosition(event.target.position!)));
    if (comment) activate(comment.item.id);
  });
  dark.addEventListener('change', theme);
  return () => {
    unregisterAnnotations(); annotationClick.dispose();
    unregisterSelection();
    dark.removeEventListener('change', theme);
    editor.dispose(); model.dispose();
  };
}

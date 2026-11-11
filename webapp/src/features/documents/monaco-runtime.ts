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

// Vite emits same-origin workers alongside the app/Storybook assets. No CDN.
globalThis.MonacoEnvironment = {
  getWorker(_id, label) { return label === 'json' ? new JsonWorker() : new EditorWorker(); },
};

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
  dark.addEventListener('change', theme);
  return () => {
    unregisterSelection();
    dark.removeEventListener('change', theme);
    editor.dispose(); model.dispose();
  };
}

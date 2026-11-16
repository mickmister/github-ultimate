import type { Customization } from '../../../../src/ui-customization';
import './customization.css';

export function CustomizationView({ json, error, notice, ready, current, actions }: {
  json: string; error: string; notice: string; ready: boolean; current: Customization;
  actions: { setJSON(value: string): void; apply(): void; preview(): void; reset(): void; cancel(): void; download(): void; example(): void; import(file: File): Promise<void> };
}) {
  return <details className="customization-panel" data-ui="customization-panel"><summary>Customize appearance</summary>
    <p>Current: {current.name}. Device-local theme tokens and custom CSS. Export the entire configuration as JSON to share it or load it on another device.</p>
    <p>Edit the complete configuration below, or use <code>uiCustomization.get()</code>, <code>preview(config)</code>, <code>apply(config)</code>, <code>reset()</code>, <code>export()</code>, and <code>import(json)</code> on <code>window.uiCustomization</code>.</p>
    <label htmlFor="ui-customization-json">Customization JSON</label><textarea id="ui-customization-json" rows={12} spellCheck={false} value={json} onChange={event => actions.setJSON(event.target.value)} />
    <div className="customization-actions"><button disabled={!ready} onClick={actions.preview}>Preview customization</button><button disabled={!ready} onClick={actions.apply}>Save customization locally</button><button disabled={!ready} onClick={actions.cancel}>Cancel preview</button><button disabled={!ready} onClick={actions.download}>Export customization JSON</button><button onClick={actions.reset}>Reset appearance</button><button onClick={actions.example}>Load example into editor</button></div>
    <label>Import customization JSON<input type="file" accept="application/json,.json" disabled={!ready} onChange={event => { const file = event.target.files?.[0]; if (file) void actions.import(file); event.target.value = ''; }} /></label>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}

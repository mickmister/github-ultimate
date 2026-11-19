import type { Customization } from '../../../../src/ui-customization';
import { builtInThemes } from '../../../../src/ui-themes';
import { settingGroups, type ThemeToken } from './settings';
import './customization.css';

export function CustomizationView({ json, draft, selectedPreset, colorValues, error, notice, ready, current, actions }: {
  json: string; draft: Customization | null; selectedPreset: string; colorValues: Partial<Record<ThemeToken, string>>; error: string; notice: string; ready: boolean; current: Customization;
  actions: { setJSON(value: string): void; preset(id: string): void; name(value: string): void; mode(value: Customization['mode']): void; token(token: ThemeToken, value: string): void; css(value: string): void; apply(): void; preview(): void; reset(): void; cancel(): void; download(): void; import(file: File): Promise<void> };
}) {
  return <details className="customization-panel" data-ui="customization-panel"><summary>Customize appearance</summary>
    <p>Current: {current.name}</p>
    <p>Changing preset replaces your draft, including custom CSS.</p>
    <label htmlFor="ui-theme-preset">Built-in theme</label><select id="ui-theme-preset" disabled={!ready} value={selectedPreset} onChange={event => actions.preset(event.target.value)}><option value="" disabled>Custom theme</option>{builtInThemes.map(theme => <option key={theme.id} value={theme.id}>{theme.id === 'system' ? 'System default' : theme.value.name}</option>)}</select>
    {builtInThemes.filter(theme => theme.id === selectedPreset).map(theme => <p className="muted" key={theme.id}>{theme.description}</p>)}
    {!draft && <p>Fix the invalid advanced JSON to use individual settings.</p>}
    <fieldset disabled={!ready || !draft} className="customization-settings"><legend>Individual settings</legend>
      <div className="customization-grid"><label>Theme name<input value={draft?.name ?? ''} maxLength={80} onChange={event => actions.name(event.target.value)} /></label>
        <div><label htmlFor="ui-theme-mode">Appearance mode</label><select id="ui-theme-mode" value={draft?.mode ?? 'system'} onChange={event => actions.mode(event.target.value as Customization['mode'])}><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></div></div>
      {settingGroups.map(group => <fieldset key={group.title}><legend>{group.title}</legend><div className="customization-grid">{group.fields.map(field => <div key={field.token} className="customization-setting">
        <label htmlFor={`theme-${field.token}`}>{field.label}</label><div className="customization-token-input">
          {field.color && <input type="color" aria-label={`Pick ${field.label.toLowerCase()}`} title="Hex color picker; use the text field for other CSS colors." disabled={!colorValues[field.token]} value={colorValues[field.token] ?? '#000000'} onChange={event => actions.token(field.token, event.target.value)} />}
          <input id={`theme-${field.token}`} value={draft?.tokens[field.token] ?? ''} placeholder={field.placeholder} spellCheck={false} onChange={event => actions.token(field.token, event.target.value)} />
          <button type="button" disabled={!draft?.tokens[field.token]} aria-label={`Use default ${field.label.toLowerCase()}`} onClick={() => actions.token(field.token, '')}>Default</button>
        </div></div>)}</div></fieldset>)}
      <label htmlFor="ui-customization-css">Custom CSS</label><textarea id="ui-customization-css" rows={4} spellCheck={false} value={draft?.css ?? ''} onChange={event => actions.css(event.target.value)} />
    </fieldset>
    <details className="customization-advanced"><summary>Advanced JSON and console</summary><p>Settings are device-local. Export JSON to share them. Blank settings use app defaults. The JSON editor and individual settings edit the same draft. Console API: <code>window.uiCustomization</code>.</p>
      <label htmlFor="ui-customization-json">Customization JSON</label><textarea id="ui-customization-json" rows={12} spellCheck={false} value={json} onChange={event => actions.setJSON(event.target.value)} /></details>
    <div className="customization-actions"><button disabled={!ready} onClick={actions.preview}>Preview customization</button><button disabled={!ready} onClick={actions.apply}>Save customization locally</button><button disabled={!ready} onClick={actions.cancel}>Cancel preview</button><button disabled={!ready} onClick={actions.download}>Export customization JSON</button><button onClick={actions.reset}>Reset appearance</button></div>
    <label>Import customization JSON<input type="file" accept="application/json,.json" disabled={!ready} onChange={event => { const file = event.target.files?.[0]; if (file) void actions.import(file); event.target.value = ''; }} /></label>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}

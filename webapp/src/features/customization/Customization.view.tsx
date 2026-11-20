import type { Customization } from '../../../../src/ui-customization';
import { builtInThemes } from '../../../../src/ui-themes';
import type { CustomizationProps } from './contracts';
import { copy } from './Customization.copy';
import { settingGroups } from './fields';

export function AppearanceHeader({ model: m }: CustomizationProps) {
  return <header className="appearance-header"><div><h1>{copy.title}</h1><span className="appearance-status">{m.busy ? copy.working : !m.ready ? copy.loading : m.dirty ? copy.unsaved : copy.unchanged}</span></div>
    <dl><div><dt>{copy.savedTheme}</dt><dd>{m.saved.name}</dd></div><div><dt>{copy.activeTheme}</dt><dd>{m.active.name}</dd></div></dl>
  </header>;
}
export function AppearanceFeedback({ model: m }: CustomizationProps) {
  return <div className="appearance-feedback">
    {m.external && <section role="alert" className="appearance-conflict"><strong>{copy.external}</strong><span>{copy.overwrite}</span><div className="appearance-actions"><button disabled={m.busy} onClick={m.actions.useSaved}>{copy.useSaved}</button><button disabled={m.busy} onClick={m.actions.keepDraft}>{copy.keepDraft}</button></div></section>}
    {(m.error || m.validationError) && <div role="alert" className="appearance-error">{m.error || m.validationError}</div>}
    <div role="status">{m.notice}</div>
  </div>;
}
export function ThemeBasics({ model: m }: CustomizationProps) {
  return <section id="appearance-theme" className="appearance-card"><h2>{copy.basics}</h2>
    <fieldset disabled={!m.ready || m.busy}>
      <label htmlFor="ui-theme-preset">{copy.preset}</label><select id="ui-theme-preset" value={m.selectedPreset} onChange={event => m.actions.preset(event.target.value)}><option value="" disabled>{copy.custom}</option>{builtInThemes.map(theme => <option key={theme.id} value={theme.id}>{theme.id === 'system' ? copy.systemDefault : theme.value.name}</option>)}</select>
      <div className="appearance-basics"><label>{copy.name}<input disabled={!m.draft} value={m.draft?.name ?? ''} maxLength={80} onChange={event => m.actions.name(event.target.value)} /></label>
        <div><label htmlFor="ui-theme-mode">{copy.mode}</label><select id="ui-theme-mode" disabled={!m.draft} value={m.draft?.mode ?? 'system'} onChange={event => m.actions.mode(event.target.value as Customization['mode'])}><option value="system">{copy.system}</option><option value="light">{copy.light}</option><option value="dark">{copy.dark}</option></select></div></div>
    </fieldset>
    {!m.draft && <div className="appearance-error">{copy.invalid}</div>}
  </section>;
}
export function ThemeGroups({ model: m }: CustomizationProps) {
  return <>{settingGroups.map((group, index) => <details id={`appearance-group-${index}`} key={group.title} className="appearance-card appearance-group" open={m.expanded[group.title] ?? false} onToggle={event => { const open = event.currentTarget.open; if (open !== (m.expanded[group.title] ?? false)) m.actions.toggle(group.title, open); }}>
    <summary>{group.title}</summary><fieldset disabled={!m.ready || !m.draft || m.busy} className="customization-grid">{group.fields.map(field => <div key={field.token} className="customization-setting">
      <label htmlFor={`theme-${field.token}`}>{field.label}</label><div className="customization-token-input">
        {field.color && <input type="color" aria-label={`${copy.pick} ${field.label.toLowerCase()}`} disabled={!m.colorValues[field.token]} value={m.colorValues[field.token] ?? '#000000'} onChange={event => m.actions.token(field.token, event.target.value)} />}
        <input id={`theme-${field.token}`} value={m.draft?.tokens[field.token] ?? ''} placeholder={field.placeholder} spellCheck={false} onChange={event => m.actions.token(field.token, event.target.value)} />
        <button type="button" disabled={!m.draft?.tokens[field.token]} aria-label={`${copy.useDefault} ${field.label.toLowerCase()}`} onClick={() => m.actions.token(field.token, '')}>{copy.default}</button>
      </div></div>)}</fieldset>
  </details>)}</>;
}
export function ThemeAdvanced({ model: m }: CustomizationProps) {
  return <details id="appearance-advanced" className="appearance-card appearance-group" open={m.expanded.advanced ?? false} onToggle={event => { const open = event.currentTarget.open; if (open !== (m.expanded.advanced ?? false)) m.actions.toggle('advanced', open); }}>
    <summary>{copy.advanced}</summary><div className="appearance-advanced-content">
      <label htmlFor="ui-customization-css">{copy.css}</label><textarea id="ui-customization-css" disabled={!m.ready || !m.draft || m.busy} rows={5} spellCheck={false} value={m.draft?.css ?? ''} onChange={event => m.actions.css(event.target.value)} />
      <label htmlFor="ui-customization-json">{copy.json}</label><textarea id="ui-customization-json" disabled={!m.ready || m.busy} rows={14} spellCheck={false} value={m.json} onChange={event => m.actions.setJSON(event.target.value)} />
      <small>{copy.advancedHelp}</small><div className="appearance-actions"><button disabled={m.busy} onClick={m.actions.download}>{copy.export}</button><button disabled={m.busy} onClick={m.actions.useSaved}>{copy.useSaved}</button></div>
      <label>{copy.import}<input type="file" accept="application/json,.json" disabled={m.busy} onChange={event => { const file = event.target.files?.[0]; if (file) void m.actions.import(file); event.target.value = ''; }} /></label>
    </div>
  </details>;
}
export function AppearancePreview({ model: m }: CustomizationProps) {
  return <aside className="appearance-preview appearance-card" aria-label={copy.previewHeading}><h2>{copy.previewHeading}</h2>
    <span className="appearance-status">{m.previewing ? m.previewMatchesDraft ? copy.previewActive : copy.previewOlder : copy.saved}</span>
    <article className="appearance-sample"><h3>{copy.sample}</h3><p>{copy.sampleText}</p><span className="appearance-sample-action">{copy.sampleAction}</span></article>
    <button disabled={!m.previewing || m.busy} onClick={m.actions.cancel}>{copy.cancel}</button>
  </aside>;
}
export function AppearanceActions({ model: m }: CustomizationProps) {
  return <footer className="appearance-toolbar" aria-label={copy.title}><div className="appearance-actions">
    <button disabled={!m.ready || !m.draft || !!m.validationError || m.busy || (m.previewing && m.previewMatchesDraft)} onClick={() => void m.actions.preview()}>{copy.preview}</button>
    <button className="appearance-primary" disabled={!m.ready || !m.draft || !!m.validationError || !m.dirty || m.busy || m.external} onClick={() => void m.actions.apply()}>{copy.save}</button>
    <button disabled={m.busy || (!m.ready && !m.error)} onClick={m.actions.reset}>{!m.ready && m.error ? copy.recover : copy.reset}</button>
    {m.canUndo && <button disabled={m.busy} onClick={m.actions.undo}>{copy.undo}</button>}
  </div></footer>;
}
export function AppearanceSections({ model: m }: CustomizationProps) {
  return <nav className="appearance-sections" aria-label={copy.sections}><a href="#appearance-theme">{copy.basics}</a>{settingGroups.map((group, index) => <a key={group.title} href={`#appearance-group-${index}`} onClick={() => m.actions.toggle(group.title, true)}>{group.title}</a>)}<a href="#appearance-advanced" onClick={() => m.actions.toggle('advanced', true)}>{copy.advanced}</a></nav>;
}

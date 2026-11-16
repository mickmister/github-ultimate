export function AppSettingsView() {
  return <details className="customization-panel app-settings">
    <summary>Settings</summary>
    <p>Hosted app build commit: <code>{import.meta.env.VITE_UI_BUILD ?? 'unavailable'}</code></p>
    <a href="../settings.html">Connection &amp; storage settings</a>
  </details>;
}

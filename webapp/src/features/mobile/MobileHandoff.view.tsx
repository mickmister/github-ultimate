export function MobileHandoffView({ appURL, entryURL, notice, onOpen }: { appURL: string; entryURL: string; notice: string; onOpen(): void }) {
  return <aside className="mobile-handoff" aria-label="Alohak app handoff" data-ui="mobile-handoff">
    <a className="mobile-handoff-open" data-ui="mobile-handoff-open" href={appURL} onClick={onOpen}>Open in Alohak</a>
    <span>Continue with this exact page in the installed app.</span>
    <details>
      <summary>First-time setup</summary>
      <p>Install Alohak, then in Native settings set the HTTPS entry URL to this deployment:</p>
      <code>{entryURL}</code>
      <p>Use Set deployment, then return here and tap Open in Alohak. Links keep their route, query and revision pins; they do not change the app’s saved deployment or grant access.</p>
    </details>
    {notice && <p role="status">{notice}</p>}
  </aside>;
}

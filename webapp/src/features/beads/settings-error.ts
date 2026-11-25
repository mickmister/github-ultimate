export function settingsError(subject: 'Workspace' | 'Filter', cause: unknown) {
  const reason = cause instanceof Error ? cause.message : 'Preference storage is unavailable.';
  const recovery = /not approved|revoked|access changed/i.test(reason)
    ? 'Grant Page storage for this deployment in extension or Alohak settings, then reload. GitHub access is separate.'
    : 'Reload this page to reconnect preference storage. Check its storage permission and quota if the problem continues.';
  return `${subject} preferences are not being saved. ${reason} ${recovery}`;
}

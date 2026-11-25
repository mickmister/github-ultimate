import { useEffect, useRef, useState } from 'react';

/** The responsive views may remount; modal intent belongs above view selection. */
export function useSettings(presentation: string) {
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const dialog = settingsDialog.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open, presentation]);
  return { settingsDialog, openSettings: () => setOpen(true), closeSettings: () => setOpen(false) };
}

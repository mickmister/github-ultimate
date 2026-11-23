"use client";

import "@/mock/install";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { ConnectionBar } from '@/extension/ConnectionBar';
import { useState } from 'react';

export function DemoRoot() {
  const [openSession, setOpenSession] = useState<{ id: string }>();
  return (
    <I18nProvider>
      <div className="pi-web-extension-host">
        <AppShell openSession={openSession} />
        <ConnectionBar onOpenSession={id => setOpenSession({ id })} />
      </div>
    </I18nProvider>
  );
}

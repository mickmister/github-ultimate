import type { MobileDocument, MobileFixtureBroker } from './mobile-protocol';

export type MobileDocumentEvent = MobileDocument & { state: 'loading' | 'ready' | 'error'; message?: string };

/** Preserve the WebView on resume, but never revive work from a previous active period. */
export class MobileLifecycle {
  private document?: MobileDocumentEvent;
  constructor(private broker: Pick<MobileFixtureBroker, 'activate' | 'invalidate'>, public active: boolean) {}

  reset() { this.document = undefined; this.broker.invalidate(); }

  documentChanged(document: MobileDocumentEvent) {
    this.broker.invalidate();
    this.document = { ...document };
    return this.activate();
  }

  stateChanged(state: string) {
    const active = state === 'active';
    if (active === this.active) return;
    this.active = active;
    this.broker.invalidate();
    return this.activate();
  }

  private activate() {
    if (!this.active || this.document?.state !== 'ready') return;
    this.broker.activate(this.document);
    return this.document;
  }
}

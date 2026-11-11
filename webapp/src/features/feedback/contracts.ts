export interface FeedbackResource {
  readonly kind: string;
  readonly id: string;
  readonly repository?: string;
  readonly workspace?: string;
  readonly path?: string;
  readonly revision?: string;
}
export interface FeedbackTarget {
  readonly elementId: string;
  readonly label: string;
  readonly uiPath: readonly string[];
  readonly featureId: string;
  readonly resource?: FeedbackResource;
  readonly representation?: string;
}
export interface FeedbackSelection {
  readonly text: string;
  readonly representation: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly ranges?: readonly { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[];
}
export interface FeedbackCapture {
  readonly target: FeedbackTarget;
  readonly selection: FeedbackSelection | null;
  readonly pageUrl: string;
  readonly appBuild: string;
  readonly capturedAt: string;
}
export type FeedbackKind = 'content-comment' | 'feature-comment';
export interface FeedbackComment {
  readonly id: string;
  readonly version: number;
  readonly kind: FeedbackKind;
  readonly comment: string;
  readonly context: FeedbackCapture;
}

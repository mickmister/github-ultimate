// Legacy copied Node-only helpers reference coding-agent APIs which are not
// shipped by this browser application. The actual pi-ai/agent-core packages
// MUST resolve their published types; never shadow those modules with stubs.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "@earendil-works/pi-coding-agent" {
  export type AgentSessionEvent = any;
  export type BashOperations = any;
  export type JsonAgentSessionEvent = any;
  export type ResourceDiagnostic = any;
  export type SessionManager = any;
  export type SettingsManager = any;
  export type SlashCommandInfo = any;
  export type Theme = any;
  export function getAgentDir(): string;
}

import type { AgentMessage } from '@/lib/types';
import { agentState, emit, registerBrowserSession } from '@/mock/agent';
import { addSession, appendEntry, ensureSessions, randomUuid, type MockSession } from '@/mock/sessions/store';
import { PROJECT_ROOT } from '@/mock/paths';

export type Connection = { id: string; revision: string; name: string; model: string };
type RuntimeSession = { systemPrompt: string; prompt(text: string): Promise<void>; abort(): void; subscribe(listener: (event: unknown) => void): () => void };
type Runtime = { connections(): Promise<Connection[]>; create(connection: Connection): RuntimeSession };
let loading: Promise<Runtime> | undefined;
export function extensionRuntime(): Promise<Runtime> {
  if (!loading) loading = new Promise<Runtime>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/extension-runtime.js`;
    script.onload = () => resolve((window as unknown as { piWebExtension: Runtime }).piWebExtension);
    script.onerror = () => { loading = undefined; script.remove(); reject(new Error('Could not load the browser Pi runtime. Reload and retry.')); };
    document.head.append(script);
  });
  return loading;
}

export async function createBrowserSession(runtime: Runtime, connection: Connection): Promise<string> {
  await ensureSessions();
  const session: MockSession = {
    id: randomUuid(), cwd: PROJECT_ROOT, name: `Extension · ${connection.name}`,
    created: new Date().toISOString(), entries: [], leafId: null, transient: false,
    live: { model: { provider: 'extension', modelId: connection.model }, thinkingLevel: 'off', running: false, streamingMessage: null, autoCompactionEnabled: false },
  };
  const agent = runtime.create(connection), live = session.live!;
  addSession(session);
  appendEntry(session, { type: 'model_change', provider: 'extension', modelId: connection.model });
  agent.subscribe(raw => {
    const event = raw as { type: string; message?: AgentMessage };
    if (event.type === 'message_end' && event.message && ['user', 'assistant', 'toolResult'].includes(event.message.role)) appendEntry(session, { type: 'message', message: structuredClone(event.message) });
    if (event.type === 'message_start' && event.message?.role === 'assistant') live.streamingMessage = event.message;
    if (event.type === 'message_end') live.streamingMessage = null;
    emit(session.id, raw as Record<string, unknown>);
  });
  registerBrowserSession(session.id, async command => {
    const ok = (data: unknown = null) => ({ ok: true as const, data });
    const fail = (error: string) => ({ ok: false as const, status: 400, error, extra: { code: 'prompt_rejected', accepted: false } });
    switch (command.type) {
      case 'prompt': {
        if (live.running) return fail('This browser session is already running. Stop it or wait for the reply.');
        if (typeof command.message !== 'string' || !command.message.trim() || command.images && Array.isArray(command.images) && command.images.length) return fail('This session supports non-empty text prompts only.');
        live.running = true;
        void agent.prompt(command.message).catch(error => {
          emit(session.id, { type: 'prompt_error', error: error instanceof Error ? error.message : 'Browser Pi failed.' });
        }).finally(() => {
          live.running = false; live.streamingMessage = null;
          emit(session.id, { type: 'agent_settled' }); emit(session.id, { type: 'prompt_done' });
        });
        return ok();
      }
      case 'abort': agent.abort(); return ok();
      case 'get_state': return ok(await agentState(session));
      case 'get_tools': case 'get_commands': return ok([]);
      case 'clear_queue': return ok({ steering: [], followUp: [] });
      case 'set_session_name': session.name = String(command.name ?? '').trim() || session.name; return ok();
      default: return fail(`Not supported by this browser text session: ${String(command.type)}`);
    }
  }, agent.systemPrompt);
  window.addEventListener('beforeunload', event => { if (live.running) event.preventDefault(); });
  return session.id;
}

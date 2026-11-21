import type { reviewPerf } from '../../../../hosted/performance';

export function ReviewDiagnosticsView({ status, summary, actions }: { status: ReturnType<typeof reviewPerf.status>; summary: ReturnType<typeof reviewPerf.summary>; actions: typeof reviewPerf }) {
  return <details className="review-diagnostics"><summary>Performance diagnostics</summary>
    <p>Local, opt-in capture. Start, reproduce a slow load or refresh, then stop and export. Records operation timings—not document contents, answers, URLs or credentials. Bridge timings include broker round trips, not a breakdown of GitHub server time.</p>
    <button disabled={status.running} onClick={actions.start}>Start performance capture</button>
    <button disabled={!status.running} onClick={() => actions.stop()}>Stop performance capture</button>
    <button disabled={!status.count} onClick={actions.download}>Export performance JSON</button>
    <button onClick={actions.clear}>Clear capture</button>
    <p>{status.running ? 'Recording' : 'Stopped'} · {status.count} spans · {status.dropped} dropped</p>
    <pre>{JSON.stringify(summary, null, 2)}</pre>
    <p>Console: <code>reviewPerf.start()</code>, <code>reviewPerf.summary()</code>, <code>reviewPerf.stop()</code>, <code>reviewPerf.export()</code>, <code>reviewPerf.download()</code>. Export uses OpenTelemetry OTLP JSON trace format; nothing is uploaded automatically.</p>
  </details>;
}

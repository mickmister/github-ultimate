## Saved workflow snapshot — manual example

This is example data, not evidence of an actual agent run. The private dashboard hostname is a placeholder. Replace it with your own tailnet URL when testing that link.

```github-workflow
{
  "kind": "workflow",
  "schema_version": 1,
  "task_id": "investigation_task",
  "title": "Investigate failing checks",
  "session_id": "session-demo",
  "attempt_id": "attempt-one",
  "status": "needs-input",
  "updated_at": "2026-11-05T07:00:00Z",
  "dashboard_url": "https://gascity.example.ts.net/",
  "dashboard_status": "offline",
  "formula": "simple-investigation",
  "summary": "The agent identified a timing-sensitive unit test and is waiting for your choice of scope. This saved comment remains useful after the runner stops.",
  "beads": [
    {
      "id": "inspect_failure",
      "title": "Inspect failing logs",
      "status": "closed"
    },
    {
      "id": "choose_scope",
      "title": "Ask the human how far to investigate",
      "status": "in_progress",
      "dependencies": ["inspect_failure"]
    },
    {
      "id": "explain_result",
      "title": "Explain the findings",
      "status": "open",
      "dependencies": ["choose_scope"]
    }
  ]
}
```

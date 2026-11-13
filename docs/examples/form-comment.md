<!-- github-ultimate:form:investigation_form -->

## Decide the next step

This is a manual GitHub Ultimate test form. It does not start a workflow until a separate handler is installed.

```github-task
{
  "format": "standard",
  "version": 1,
  "id": "investigation_form",
  "task_id": "investigation_task",
  "session_id": "session-demo",
  "title": "Investigate the failing checks",
  "goal": "Choose the scope before the agent continues",
  "description": "The previous run inspected the failure. Your answers continue the same durable session. Choose **discussion** to ask another question without authorizing implementation, or **Approved for next steps** to approve the next step.",
  "questions": [
    {
      "type": "choices",
      "id": "scope",
      "title": "Which checks should we inspect?",
      "description": "Pick one scope. These are checkboxes, with an exactly-one choice group.",
      "required": true,
      "choiceGroups": [
        {
          "id": "scope_selection",
          "mode": "exactlyOne",
          "choiceIds": ["unit", "all"]
        }
      ],
      "choices": [
        {
          "id": "unit",
          "label": "Only failing unit tests",
          "description": "Keep the next investigation focused.",
          "is_recommended_reason": "Fast feedback with a smaller context.",
          "prosAndCons": {
            "pros": ["Faster investigation"],
            "cons": ["May miss integration failures"]
          }
        },
        {
          "id": "all",
          "label": "The entire test suite",
          "description": "Inspect unit and integration failures together."
        }
      ]
    },
    {
      "type": "textarea",
      "id": "additional_notes",
      "title": "Additional notes",
      "description": "What should the agent know before continuing?",
      "placeholder": "For example: explain why the test fails before changing anything."
    }
  ]
}
```

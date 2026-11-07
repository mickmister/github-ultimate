<!-- github-ultimate:form:followup_form -->

## A small follow-up

```github-task
---
format: standard
version: 1
id: followup_form
task_id: investigation_task
session_id: session-demo
title: A quick follow-up question
goal: Continue the existing conversation
allowCodeFileChanges: false
questions:
  - type: textarea
    id: question
    title: What would you like to ask?
    description: The next workflow run should restore the original session.
    required: true
    placeholder: Why did the unit test fail only in CI?
---
This form only produces a **discussion** command. It cannot approve implementation.
```

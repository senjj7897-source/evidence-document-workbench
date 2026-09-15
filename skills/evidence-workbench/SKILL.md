---
name: evidence-workbench
description: Orchestrate source-grounded comparison, review, improvement, style learning, and knowledge governance for high-stakes documents. Use when a task spans several of these capabilities or the user wants an end-to-end evidence trail.
metadata:
  version: "1.0.0"
  author: "senjj7897-source"
---

# Evidence Workbench

Turn documents into an auditable decision process. The goal is not to maximize findings or produce fluent prose; it is to make every material claim traceable to source evidence and an explicit uncertainty boundary.

## Route the task

- Use `multi-document-diff` for versions or several documents describing the same subject.
- Use `evidence-document-review` for errors, contradictions, omissions, data checks, and execution-loop gaps.
- Use `traceable-document-improvement` when the user wants recommendations or a revised draft.
- Use `adopted-style-memory` only to learn from explicitly adopted or designated final samples.
- Use `knowledge-status-governance` to organize policies, drafts, historical material, and version relationships.

When companion Skills are unavailable, apply the shared contract below directly and state which specialist step could not be completed.

## Shared evidence contract

1. Inventory the supplied materials and lock the comparison object, time period, version, and scope before judging.
2. Keep four conclusion classes separate: direct fact, confirmable omission, pending conflict, and risk inference.
3. Attach a file name and the narrowest available page, clause, paragraph, table, or cell location to every material finding. Quote only the minimum text needed to identify it.
4. Search later sections, attachments, tables, and companion files for counterevidence before reporting a gap.
5. Treat missing required material as `cannot verify`, never as `no issue found`.
6. Do not invent the missing answer, silently resolve conflicts, auto-contact another party, or treat a generated draft as adopted.

## Default working view

Lead with a deduplicated issue list. Each issue should open into:

`source text -> comparison or governing basis -> conclusion -> impact -> recommendation -> status`

Use only `ignored` and `resolved` as user-controlled terminal states. Keep open findings open until evidence or a user decision closes them.

## Completion

Report separately whether processing finished, review coverage is complete, issues are resolved, and the output is ready to submit. One state never proves another.

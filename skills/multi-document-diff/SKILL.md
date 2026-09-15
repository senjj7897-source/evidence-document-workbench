---
name: multi-document-diff
description: Compare two or more documents or versions at fact, rule, scope, number, formula, and meaning level. Use for cross-document reconciliation or revision analysis where a plain text diff is insufficient.
metadata:
  version: "1.0.0"
  author: "senjj7897-source"
---

# Multi-document Semantic Diff

Find differences that change decisions, not merely characters.

## Before comparing

- List every file with its apparent role and version evidence.
- Align subject, period, effective scope, unit, and document role. If alignment is uncertain, record that uncertainty before judging a conflict.
- Separate current text, insertions, deletions, comments, and tracked revisions. Never mix deleted text into the active version.

## Compare in layers

1. Facts and identifiers: names, dates, amounts, ratios, lists, document numbers, and referenced attachments.
2. Rules and decisions: obligations, permissions, thresholds, exceptions, approvals, and consequences.
3. Execution logic: owner, trigger, input, action, output, monitoring, escalation, release, and review.
4. Data implementation: units, precision, formulas, hidden values, mappings, and aggregation scope.
5. Expression and structure: terminology, section placement, cross-references, and meaning-changing edits.

Search the full supplied set for explanations or superseding text before calling a discrepancy an error.

## Output

Return one deduplicated row per substantive difference with comparison subject, each source position and minimal text, alignment status, difference type, practical effect, conclusion class, and recommended verification or revision.

State `cannot verify` when a required version, attachment, formula, or source file is absent. Do not use filename recency alone to decide which version governs.

---
name: evidence-document-review
description: Review documents for confirmed errors, contradictions, confirmable omissions, data inconsistencies, and execution-loop gaps with source locations. Use for formal, regulated, audit, risk, legal, or management materials.
metadata:
  version: "1.0.0"
  author: "senjj7897-source"
---

# Evidence-linked Document Review

Review what the materials prove, what they omit, and what remains uncertain.

## Review sequence

1. Record the document purpose, audience, version, scope, and supplied attachments.
2. Check exact items first: amounts, counts, dates, ratios, IDs, lists, units, currency, precision, formulas, duplicates, missing values, and cross-references.
3. Check meaning: definitions, responsibilities, conditions, exceptions, sequencing, and cross-document consistency.
4. Trace every capability commitment through the execution loop: trigger -> owner -> input -> action -> output -> monitoring -> escalation -> release -> validation -> review.
5. Search the entire document set, tables, notes, and attachments for counterevidence.

## Finding discipline

Classify every finding as `direct fact`, `confirmable omission`, `pending conflict`, or `risk inference`. Do not convert a difference into an error without a rule, template, recomputation, or internal contradiction. Do not describe missing companion data as a clean review.

## Output contract

Lead with a deduplicated issue list. Each issue must contain title, severity, conclusion class, source location, minimal quote, basis, impact, recommendation, and open status. Where coverage is blocked, name the missing material or inaccessible feature, such as formulas, hidden ranges, revisions, comments, or page layout.

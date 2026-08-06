---
name: review-working-copy
description: Review a ccp working-copy bundle and post line-anchored findings back to ccp. Use when a prompt supplies a ccp origin and review ID after a Claude Code turn stops, or explicitly asks for a ccp working-copy review.
---

# Review Working Copy

## Preserve the fact boundary

Treat the ccp backend as the single source of facts. Act as a pure function from the supplied bundle to findings.

Do not fetch or reconstruct repository facts. Do not run `git`, `gh`, or a code-review MCP. Do not read working-copy files. GET the bundle only from `<ccp-origin>/api/reviews/<review-id>` and POST the result only to `<ccp-origin>/api/reviews/<review-id>/findings`.

Fetch the bundle once. Keep the raw response without displaying it as a whole.

## Review the diff in isolation

Read the bundle's `diff` before reading `findings`, comment threads, or prior discussion. Do not inspect those fields until the independent diff pass is complete. This ordering prevents prior opinions from biasing defect discovery.

Inspect every changed hunk for correctness, regressions, unsafe behavior, missing validation, and missing tests. Ignore style-only observations unless they obscure a defect. Record each candidate against an exact changed line from the unified diff.

Use the hunk coordinates directly:

- `file`: repository-relative path from the diff header
- `side`: `new` for added/context code or `old` for deleted code
- `line`: exact line number on that side
- `endLine`: include only for a contiguous range

## Reconcile after discovery

Only after completing the independent pass, read existing `findings`. Reconcile duplicates and resolved discussion without discarding a newly discovered issue merely because prior text disagrees. Preserve still-valid prior findings when replacing the findings array wholesale.

## Post the findings

POST a strict JSON object shaped as:

```json
{
  "findings": [
    {
      "id": "finding-100",
      "file": "src/example.ts",
      "side": "new",
      "line": 10,
      "severity": "high",
      "title": "Short defect title",
      "body": "Explain the failure mode and when it occurs.",
      "suggestion": "Optional concrete correction.",
      "resolved": false
    }
  ]
}
```

Use only `high`, `medium`, `low`, or `nit` severity. Use stable, unique IDs within this review. Omit `suggestion` and `endLine` when they do not apply. Post `{"findings":[]}` when the diff has no actionable findings.

Return a concise completion note with the finding count after ccp accepts the POST.

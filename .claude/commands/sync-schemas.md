---
description: Find JSONL/settings fields seen on disk that strict Zod schemas don't allow, and add them as optional.
---

We have several "<X>Schema against disk" vitest tests that walk `~/.claude/` and validate real files against our strict Zod schemas. When Claude Code (or settings, or hooks) starts emitting a new field, those tests fail with `unrecognized_keys`. The fix is always the same shape: add the field as `.optional()` (or a union branch) to the right schema. See commit `9cb1b41` for the canonical example.

This command automates the loop.

## Steps

1. Run the disk-validation suite and capture output:

   ```bash
   npm run test:run -- -t "against disk" 2>&1
   ```

   Tests covered by this filter:
   - `JsonlRecordSchema against disk` — scans every line of every `~/.claude/projects/**/*.jsonl`
   - `TaskFileSchema against disk` — scans `~/.claude/tasks/**/*.json`
   - `SessionsIndexSchema against disk` — `sessions-index.json` files
   - `ClaudeSettingsSchema against disk` — project-level settings
   - `McpConfigSchema against disk` — `.mcp.json` files

2. If all pass, stop — nothing to sync.

3. If any fail, parse the failure output. Each failure block looks like:

   ```
   <projectDir>/<file>:<line>
     <path.to.field>: <issue message>
   ```

   For `unrecognized_keys` issues, the issue message names the keys (e.g. `Unrecognized key(s) in object: 'interruptedMessageId'`).

   Group failures by **(schema, key path)** so you fix each missing field once even if it appears in 50 files.

4. For each unique unrecognized key:
   - Find the right schema in `src/lib/schemas.ts`, `src/lib/tool-input-schemas.ts`, `src/lib/hook-events.ts`, or `src/lib/settings-schema.ts` based on the record `type` field shown in surrounding context. Read a few of the actual failing JSONL lines if the shape is ambiguous — `head -n <line> <file> | tail -1 | jq` is fine.
   - Add the field as `.optional()` with the **strictest type the on-disk data supports**. Read the actual values from disk before choosing the type. Avoid `z.unknown()` or `z.record(z.string(), z.unknown())` fallbacks (see [[feedback_strict_schemas]]) — if you genuinely can't pin the shape, surface that as a question rather than weakening the schema.
   - If the field is sometimes a string and sometimes an object (we have prior art for `origin`, `error`, `errorDetails`), use a `z.union([...])` not a permissive record.
   - Keep the existing `.strict()` on the object — never downgrade it to `.passthrough()`.

5. For non-`unrecognized_keys` issues (type mismatches, invalid enum values), the fix may be widening an existing field. Read the surrounding schema and the failing values, then decide:
   - String that's now sometimes a number → `z.union([z.string(), z.number()])`
   - Enum that has a new variant → add the variant to the enum
   - Surface anything weirder as a question before editing.

6. Re-run `npm run test:run -- -t "against disk"` to confirm green. If new failures appear (cascading), repeat.

7. Stage the schema files. Commit message format follows existing precedent — see `git log --oneline -- src/lib/schemas.ts src/lib/tool-input-schemas.ts`. The canonical title is "Add missing optional fields to JSONL schemas to match real-world data on disk." — vary the wording if the touched files are different (settings, hooks, tool inputs).

## Notes

- Do not run the full test suite. The `-t "against disk"` filter is fast (~8s) and the rest of the suite is irrelevant to this fix.
- Do not commit unless explicitly asked — per project convention, prepare the change and stop.
- If `JsonlRecordSchema` itself is missing a discriminator variant (a new top-level record `type`), that's a bigger change than a missing optional field — surface it and ask before adding a new schema.

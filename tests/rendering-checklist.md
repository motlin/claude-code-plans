# Rendering Audit Checklist Template

Use this checklist when auditing a category of Claude Code rendering features. This ensures consistent methodology and documentation across all feature categories.

## Setup

1. **Choose a feature category** from: Tools, Commands, Message Types, Content Blocks, Session Features, UI Chrome
2. **Select 3-5 specific features** within the category
3. **Find real JSONL examples** from sessions in `~/.claude/projects/`
4. **Render in our viewer** by navigating to the session detail view
5. **Compare with Claude Code web viewer** (side-by-side or via screenshots)
6. **Document differences** using the structure below

## Feature Audit Status Table

At the top of each findings document, include an audit status table:

```markdown
| Feature | Audited | Differences Found | Tasks Created |
|---------|---------|-------------------|---------------|
| Feature 1 | Yes | N | Y/N |
| Feature 2 | Yes (no examples) | 0 | N/A |
| Feature 3 | Yes | N | Y/N |
```

Columns:
- **Feature**: Name of the feature being audited
- **Audited**: "Yes" if audited; "Yes (no examples)" if no JSONL found
- **Differences Found**: Number of differences discovered (0 if no examples or none found)
- **Tasks Created**: "Y" if fix tasks created; "N" if defect is low priority; "N/A" if no examples

## JSONL Examples Section

Document how you captured and found the JSONL:

```markdown
## JSONL Examples Captured

Real examples extracted from sessions in `~/.claude/projects/-Users-craig-projects-claude-code-plans/`.

### Tools with JSONL examples found

- **Feature Name**: `sessionid` session -- brief description of the example
  - Tool call appeared as: tool_use block with specific input params
  - Result format: tool_result block with content structure

### Tools with NO JSONL examples found

- **Feature Name**: Not used in any local session
```

## Per-Feature Finding Format

For each feature with a difference found, create a section:

```markdown
### N. Feature Name

**JSONL example** (from `sessionid`):
```json
// tool_use / message structure
{ key: "value", ... }
// result/following message
{ ... }
```

**Our rendering** (files involved and current behavior):
- Describe current implementation (which file, which function)
- Describe what is rendered and how
- Note any limitations or missing pieces

**Claude Code web viewer** (from screenshots/live testing):
- Describe what the web viewer displays
- Note styling, layout, interactions
- Describe how params/inputs are displayed

**Differences found**:

1. **P{1|2|3} - Short title**: Detailed description of the difference. Why it matters. What field(s) are missing or what styling is wrong.

2. **P{1|2|3} - Another difference**: ...

---
```

### Priority Levels

- **P1 - Critical**: Feature is non-functional or unusable without this fix. User cannot understand the result.
- **P2 - Important**: Feature has reduced functionality or clarity. Important context is missing but workarounds exist.
- **P3 - Polish**: Visual style, spacing, or non-essential context differences. Functionality still works.

## Cross-Cutting Issues Section

If you find issues that affect multiple features, document them separately:

```markdown
## Cross-Cutting Issues

### CC1. Common pattern affecting multiple tools

**Description**: Explain the common issue.

**Affected**: Tool A, Tool B, Tool C

**Priority: P{1|2|3}** -- explanation

### CC2. Another pattern

...
```

## Summary of Follow-Up Tasks

At the end, summarize all findings as actionable tasks:

```markdown
## Summary of Follow-Up Tasks

Ordered by priority:

| # | Priority | Task | Affected Features |
|---|----------|------|------------------|
| 1 | P1 | Implement feature X | Feature A, Feature B |
| 2 | P1 | Fix feature Y | Feature C |
| 3 | P2 | Add styling for feature Z | Feature A |
| ... | ... | ... | ... |
```

## Creating Follow-Up Tasks

For each difference found, create a task in `.llm/todo.md`:

```bash
python /Users/craig/.claude/plugins/cache/motlin-claude-code-plugins/markdown-tasks/1.7.4/scripts/task_add.py .llm/todo.md "Fix: [Tool/Feature Name] - [Specific issue]
  Priority: P{1|2|3}
  Affected file: path/to/file.ts
  Example session: sessionid
  Change required: description of the fix
  Success criteria: how to verify it works"
```

## Verification Checklist

Before submitting findings:

- [ ] All features in the category are listed in the status table
- [ ] At least 2-3 features have real JSONL examples
- [ ] JSONL examples are real, not paraphrased (include the actual JSON)
- [ ] All differences are documented with priority levels
- [ ] Priority assignments are consistent (P1 for critical, P2 for important, P3 for polish)
- [ ] Follow-up tasks are created for P1 and P2 differences
- [ ] Cross-cutting issues are identified and summarized
- [ ] File paths and session IDs are accurate and verifiable
- [ ] Comparison between our viewer and Claude Code web viewer is thorough

/**
 * Real-shape `SubagentStart` hook payload. Symmetric with `SubagentStop` —
 * fires when a subagent is spawned. The viewer uses this to render a
 * "subagent running" pill in the subagents view before the matching
 * `SubagentStop` lands. `agent_config` carries the spawn-site args (model,
 * tools, system prompt); `hook_specific_output.additionalContext` is Claude
 * Code's slot for injecting strings into the subagent's first turn.
 */
export const subagentStartFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "SubagentStart" as const,
  agent_type: "general-purpose",
  agent_id: "sub-456",
  agent_config: {
    model: "claude-sonnet-4-6",
    system_prompt: "You are a focused subagent.",
    tools: ["Read", "Grep", "Bash"],
    description: "research the codebase",
  },
  hook_specific_output: {
    hookEventName: "SubagentStart" as const,
    additionalContext: "Prefer absolute paths.",
  },
};

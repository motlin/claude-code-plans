/**
 * Real-shape `PostToolUseFailure` hook payload. Fires when a tool call fails
 * — the input mirrors `PostToolUse` minus `tool_response` plus an `error`
 * description and an optional `hook_specific_output` carrying
 * `additionalContext` / `systemMessage` strings Claude Code injects into the
 * next turn.
 */
export const postToolUseFailureFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "PostToolUseFailure" as const,
  tool_name: "Bash" as const,
  tool_use_id: "toolu_failure_01",
  tool_input: { command: "exit 1" },
  error: "Command exited with status 1",
  hook_specific_output: {
    hookEventName: "PostToolUseFailure" as const,
    additionalContext: "Consider checking the exit code before running.",
    systemMessage: "The Bash command failed.",
  },
};

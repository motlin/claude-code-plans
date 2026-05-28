/**
 * Real-shape `MessageDisplay` hook payload. Fires while assistant message text
 * is about to be rendered in the terminal — other hooks can transform or hide
 * the text via `hookSpecificOutput.displayContent`, but the viewer is a
 * passive observer and only forwards the event. The exact input shape is not
 * yet documented at code.claude.com/docs/en/hooks; this fixture pins the
 * fields we expect to see on the wire so the round-trip test catches any
 * schema drift Claude Code ships.
 */
export const messageDisplayFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "MessageDisplay" as const,
  message: "Here is the answer you asked for.",
  message_id: "msg_018a7f9b2c3d4e5f",
};

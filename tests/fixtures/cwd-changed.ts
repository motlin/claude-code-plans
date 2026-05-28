/**
 * Real-shape `CwdChanged` hook payload. Fires when the working directory
 * changes mid-session (e.g. the user runs `cd` via Bash). Sessions in this
 * viewer are keyed by project (cwd), so this event lets the active-session
 * sidebar re-home the session under its new project.
 */
export const cwdChangedFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "CwdChanged" as const,
  old_cwd: "/Users/u/projects/app",
  new_cwd: "/Users/u/projects/other-app",
};

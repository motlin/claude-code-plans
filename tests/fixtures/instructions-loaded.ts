/**
 * Real-shape `InstructionsLoaded` hook payload. Fires when Claude Code loads a
 * CLAUDE.md or `.claude/rules/*.md` file into the session context. This is the
 * common case — top-level CLAUDE.md picked up at session start.
 */
export const instructionsLoadedFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "InstructionsLoaded" as const,
  file_path: "/Users/u/projects/app/CLAUDE.md",
  memory_type: "project",
  load_reason: "session_start" as const,
  globs: ["**/*.ts", "**/*.tsx"],
  trigger_file_path: "/Users/u/projects/app/CLAUDE.md",
  parent_file_path: "/Users/u/projects/app/CLAUDE.md",
};

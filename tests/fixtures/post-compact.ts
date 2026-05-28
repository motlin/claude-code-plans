/**
 * Real-shape `PostCompact` hook payload. Symmetric with `PreCompact` — fires
 * after Claude Code finishes compacting the session transcript. The viewer
 * broadcasts `SESSION_COMPACTED` so the UI can clear the in-progress
 * compacting indicator that `PreCompact` set. `reason` mirrors the
 * `PreCompact.trigger` vocabulary; `tokens_removed` is the count Claude Code
 * reports for how much context the compaction freed.
 */
export const postCompactFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "PostCompact" as const,
  reason: "auto" as const,
  tokens_removed: 12345,
};

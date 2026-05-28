/**
 * Real-shape `WorktreeRemove` hook payload. Symmetric with `WorktreeCreate` —
 * fires when a worktree is removed. The viewer broadcasts `WORKTREE_REMOVED`
 * so any worktree-aware UI can react in real time. `worktree_path` is the
 * absolute path Claude Code reports for the removed worktree.
 */
export const worktreeRemoveFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "WorktreeRemove" as const,
  worktree_path: "/Users/u/projects/app-wt-foo",
};

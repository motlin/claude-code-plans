/**
 * Real-shape `TaskCreated` hook payload. Symmetric with `TaskCompleted` —
 * fires when a `TaskCreate` tool runs. The viewer broadcasts a `TASK_CREATED`
 * domain event so the tasks page can render the new row before the JSON file
 * write hits the chokidar watcher.
 */
export const taskCreatedFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "TaskCreated" as const,
  task_id: "task-002",
  task_subject: "Ship feature",
  task_description: "Implement the new feature end-to-end.",
};

/**
 * Project id for session-scoped task directories whose session is not in the
 * index. The double underscores keep it from colliding with a real project id,
 * which is always an encoded filesystem path, or with a plain task directory
 * name, which falls back to the directory itself as its project id.
 */
export const ORPHANED_TASKS_PROJECT_ID = "__orphaned__";

/** Heading the /tasks page renders for {@link ORPHANED_TASKS_PROJECT_ID}. */
export const ORPHANED_TASKS_PROJECT_NAME = "Orphaned tasks";

/** Explains the heading, which otherwise names no project the user knows. */
export const ORPHANED_TASKS_DESCRIPTION =
  "Task files under ~/.claude/tasks/ that name a session with no indexed transcript, so no project owns them and there is nothing to link to.";

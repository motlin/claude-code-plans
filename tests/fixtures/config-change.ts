/**
 * Real-shape `ConfigChange` hook payload. Fires when a configuration file
 * changes during the session. `config_source` is Claude Code's vocabulary for
 * which settings layer changed; `skills` corresponds to the plugin manifests
 * directory and triggers an additional `CONTENT_UPDATED` broadcast so the
 * plugins view refreshes.
 */
export const configChangeFixture = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
  hook_event_name: "ConfigChange" as const,
  config_source: "user_settings" as const,
  changed_fields: ["hooks.PostToolUse", "permissions.allow"],
};

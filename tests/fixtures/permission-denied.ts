/**
 * `PermissionDenied` payload in the hooks reference's shape (code.claude.com
 * /docs/en/hooks, 2.1.302): the auto-mode classifier denied a tool call. Not
 * captured live, because provoking a classifier denial needs a command the
 * classifier treats as dangerous.
 */
export const permissionDeniedFixture = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
	permission_mode: "auto",
	hook_event_name: "PermissionDenied" as const,
	tool_name: "Bash" as const,
	tool_input: {
		command: "rm -rf /tmp/build",
		description: "Clean build directory",
	},
	tool_use_id: "toolu_01ABC123",
	reason: "[Irreversible Local Destruction]",
};

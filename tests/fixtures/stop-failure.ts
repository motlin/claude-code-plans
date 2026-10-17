/**
 * Real `StopFailure` payload captured from Claude Code 2.1.302 (`claude -p
 * --model <unknown id>`), paths anonymized. Fires instead of `Stop` when the
 * turn ends on an API error; `last_assistant_message` is the error text the
 * conversation shows, and this capture carries no `permission_mode` or
 * `error_details`.
 */
export const stopFailureFixture = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
	prompt_id: "8a6a64ee-0b38-428d-a88b-6976f638626d",
	effort: {level: "high"},
	hook_event_name: "StopFailure" as const,
	error: "model_not_found",
	last_assistant_message:
		"There's an issue with the selected model (claude-nonexistent-model-9). It may not exist or you may not have access to it. Run --model to pick a different model.",
};

/** The hooks reference's rate-limit example, which also carries `error_details`. */
export const stopFailureRateLimitFixture = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
	hook_event_name: "StopFailure" as const,
	error: "rate_limit",
	error_details: "429 Too Many Requests",
	last_assistant_message: "API Error: Rate limit reached",
};

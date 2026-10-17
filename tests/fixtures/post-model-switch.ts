/**
 * Real `PostModelSwitch` payload captured from Claude Code 2.1.302 after a
 * stream-json `set_model` control request (`source: "sdk"`), paths anonymized.
 */
export const postModelSwitchFixture = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
	hook_event_name: "PostModelSwitch" as const,
	from_model: "claude-sonnet-5-5",
	to_model: "claude-haiku-5-5",
	requested_model: "haiku",
	source: "sdk" as const,
	context_tokens: 0,
	prompt_cache_warm: false,
	cache_ttl: "1h" as const,
	estimated_cache_write_usd: 0,
	pricing: "catalog" as const,
};

/** An automatic fallback: `requested_model` is null when `source` is `auto`. */
export const postModelSwitchAutoFixture = {
	...postModelSwitchFixture,
	from_model: "claude-opus-5-5",
	to_model: "claude-sonnet-5-5",
	requested_model: null,
	source: "auto" as const,
	context_tokens: 182_340,
	prompt_cache_warm: true,
	cache_ttl: "5m" as const,
	estimated_cache_write_usd: 1.1396,
};

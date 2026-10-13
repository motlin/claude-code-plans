/**
 * Real-shape hook payloads from Claude Code 2.1.296, which sends
 * `scratchpad_dir` on every event. Keys, order and nesting are copied from
 * payloads the hook endpoint recorded as schema drift; values are fabricated.
 */
const envelope = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
	scratchpad_dir: "/private/tmp/claude-501/-Users-u-projects-app/abc-123/scratchpad",
	prompt_id: "prompt-100",
	permission_mode: "auto",
	effort: {level: "medium"},
};

const QUESTION = "Go with option 4, or keep the timeout and use option 2?";

const QUESTIONS = [
	{
		question: QUESTION,
		header: "Approach",
		multiSelect: false,
		options: [
			{label: "Option 4 (Recommended)", description: "Drop query_timeout."},
			{label: "Option 2", description: "Keep the timeout."},
		],
	},
];

export const preToolUseWithScratchpadFixture = {
	...envelope,
	hook_event_name: "PreToolUse" as const,
	tool_name: "AskUserQuestion",
	tool_input: {questions: QUESTIONS},
	tool_use_id: "toolu_abc",
};

export const postToolUseWithScratchpadFixture = {
	...envelope,
	hook_event_name: "PostToolUse" as const,
	tool_name: "AskUserQuestion",
	tool_input: {questions: QUESTIONS, answers: {[QUESTION]: "Option 4 (Recommended)"}},
	tool_response: {questions: QUESTIONS, answers: {[QUESTION]: "Option 4 (Recommended)"}},
	tool_use_id: "toolu_abc",
	duration_ms: 1,
};

export const stopWithScratchpadFixture = {
	...envelope,
	hook_event_name: "Stop" as const,
	stop_hook_active: false,
	last_assistant_message: "The hooks are installed.",
	background_tasks: [{id: "tk100", type: "teammate", status: "running", description: "Parity explorer"}],
	session_crons: [],
};

import {breakdownFromTwin, latestBreakdown, type ContextBreakdown} from "../src/lib/context-breakdown";
import type {ContextUsageTwin} from "../src/lib/schemas";

const twin: ContextUsageTwin = {
	model: "claude-opus-5-5",
	total_tokens: 180_200,
	raw_max_tokens: 1_000_000,
	percentage: 18,
	categories: [
		{name: "System prompt", tokens: 3_100, kind: "used"},
		{name: "MCP tools", tokens: 41_000, kind: "deferred"},
		{name: "Messages", tokens: 143_500, kind: "used"},
		{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
		{name: "Free space", tokens: 786_800, kind: "free"},
	],
	mcp_tools: [{name: "mcp__github__get_me", server_name: "github", tokens: 210}],
	memory_files: [{path: "/Users/me/.claude/CLAUDE.md", type: "User", tokens: 1_200}],
	agents: [{agent_type: "Explore", source: "built-in", tokens: 340}],
};

const expected: ContextBreakdown = {
	categories: [
		{name: "System prompt", tokens: 3_100, kind: "used"},
		{name: "MCP tools", tokens: 41_000, kind: "deferred"},
		{name: "Messages", tokens: 143_500, kind: "used"},
		{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
		{name: "Free space", tokens: 786_800, kind: "free"},
	],
	totalTokens: 180_200,
	rawMaxTokens: 1_000_000,
	percentage: 18,
	mcpTools: [{name: "mcp__github__get_me", serverName: "github", tokens: 210}],
	memoryFiles: [{path: "/Users/me/.claude/CLAUDE.md", type: "User", tokens: 1_200}],
	agents: [{agentType: "Explore", source: "built-in", tokens: 340}],
	fetchedAt: "2026-10-20T13:50:04.000Z",
	source: "context-command",
};

function contextRecord(timestamp: string, usage: ContextUsageTwin = twin) {
	return {
		type: "system",
		subtype: "local_command",
		timestamp,
		content: "<local-command-stdout>## Context Usage</local-command-stdout>",
		commandRun: {command: "context", args: ""},
		contextUsage: usage,
	};
}

const assistant = {type: "assistant", timestamp: "2026-10-20T14:00:00.000Z", message: {model: "claude-opus-5-5"}};

describe("breakdownFromTwin", () => {
	it("maps the snake_case twin to the camelCase breakdown", () => {
		expect(breakdownFromTwin(twin, "2026-10-20T13:50:04.000Z")).toStrictEqual(expected);
	});
});

describe("latestBreakdown", () => {
	it("returns null without a /context run", () => {
		expect(latestBreakdown([assistant])).toBeNull();
	});

	it("returns the twin of the only /context run", () => {
		expect(latestBreakdown([contextRecord("2026-10-20T13:50:04.000Z"), assistant])).toStrictEqual(expected);
	});

	it("prefers the newest of two twins", () => {
		const newer: ContextUsageTwin = {...twin, total_tokens: 82_800, percentage: 8};
		expect(
			latestBreakdown([
				contextRecord("2026-10-19T10:00:00.000Z"),
				contextRecord("2026-10-20T13:50:04.000Z", newer),
			]),
		).toStrictEqual({...expected, totalTokens: 82_800, percentage: 8});
	});

	it("goes stale when a compact boundary follows the twin", () => {
		const boundary = {type: "system", subtype: "compact_boundary", timestamp: "2026-10-20T15:00:00.000Z"};
		expect(latestBreakdown([contextRecord("2026-10-20T13:50:04.000Z"), boundary])).toBeNull();
	});

	it("goes stale when a /clear follows the twin", () => {
		const clear = {
			type: "system",
			subtype: "local_command",
			timestamp: "2026-10-20T15:00:00.000Z",
			content: "<command-name>/clear</command-name>",
			commandRun: {command: "clear", args: ""},
		};
		expect(latestBreakdown([contextRecord("2026-10-20T13:50:04.000Z"), clear])).toBeNull();
	});

	it("skips a malformed twin", () => {
		expect(latestBreakdown([{...contextRecord("2026-10-20T13:50:04.000Z"), contextUsage: {model: 1}}])).toBeNull();
	});
});

import {
	breakdownFromTwin,
	buildContextLegend,
	latestBreakdown,
	type ContextBreakdown,
} from "../src/lib/context-breakdown";
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

function breakdown(
	categories: ContextBreakdown["categories"],
	overrides: Partial<ContextBreakdown> = {},
): ContextBreakdown {
	return {...expected, categories, ...overrides};
}

describe("buildContextLegend", () => {
	it("folds the meter tail into Other when more than six series would show", () => {
		const used = [3, 9, 1, 7, 5, 8, 2, 6, 4].map((n) => ({
			name: `Used ${n}`,
			tokens: n * 1_000,
			kind: "used" as const,
		}));
		const b = breakdown([
			...used,
			{name: "MCP tools", tokens: 2_000, kind: "deferred"},
			{name: "System tools", tokens: 5_000, kind: "deferred"},
			{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
			{name: "Free space", tokens: 500_000, kind: "free"},
		]);
		const usedLegend = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => ({
			name: `Used ${n}`,
			tokens: n * 1_000,
			kind: "used",
			id: `used-${i}`,
			meterSeries: i < 4 ? `used-${i}` : "other",
			color: null,
		}));
		expect(buildContextLegend(b, null)).toStrictEqual({
			legend: [
				...usedLegend,
				{
					name: "Autocompact buffer",
					tokens: 33_000,
					kind: "buffer",
					id: "buffer",
					meterSeries: "buffer",
					color: null,
				},
				{
					name: "Free space",
					tokens: 500_000,
					kind: "free",
					id: "free",
					meterSeries: null,
					color: "var(--chart-reference-tint)",
				},
				{
					name: "System tools",
					tokens: 5_000,
					kind: "deferred",
					id: "deferred-0",
					meterSeries: null,
					color: "var(--chart-muted)",
				},
				{
					name: "MCP tools",
					tokens: 2_000,
					kind: "deferred",
					id: "deferred-1",
					meterSeries: null,
					color: "var(--chart-muted)",
				},
			],
			meterCategories: [
				{id: "used-0", label: "Used 9"},
				{id: "used-1", label: "Used 8"},
				{id: "used-2", label: "Used 7"},
				{id: "used-3", label: "Used 6"},
				{id: "other", label: "Other", color: "reference"},
				{id: "buffer", label: "Autocompact buffer", color: "muted"},
			],
			meterValues: {
				"used-0": 9_000,
				"used-1": 8_000,
				"used-2": 7_000,
				"used-3": 6_000,
				other: 15_000,
				buffer: 33_000,
			},
			barTotal: 1_000_000,
			usedTokens: 45_000,
			usedPct: 4.5,
		});
	});

	it("adds a Since last update row taken out of Free space when live tokens exceed the breakdown", () => {
		const b = breakdown([
			{name: "System prompt", tokens: 20_000, kind: "used"},
			{name: "Messages", tokens: 100_000, kind: "used"},
			{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
			{name: "Free space", tokens: 847_000, kind: "free"},
		]);
		expect(buildContextLegend(b, 130_000)).toStrictEqual({
			legend: [
				{name: "Messages", tokens: 100_000, kind: "used", id: "used-0", meterSeries: "used-0", color: null},
				{name: "System prompt", tokens: 20_000, kind: "used", id: "used-1", meterSeries: "used-1", color: null},
				{name: "Since last update", tokens: 10_000, id: "since", meterSeries: "since", color: null},
				{
					name: "Autocompact buffer",
					tokens: 33_000,
					kind: "buffer",
					id: "buffer",
					meterSeries: "buffer",
					color: null,
				},
				{
					name: "Free space",
					tokens: 837_000,
					kind: "free",
					id: "free",
					meterSeries: null,
					color: "var(--chart-reference-tint)",
				},
			],
			meterCategories: [
				{id: "used-0", label: "Messages"},
				{id: "used-1", label: "System prompt"},
				{id: "since", label: "Since last update", color: "reference"},
				{id: "buffer", label: "Autocompact buffer", color: "muted"},
			],
			meterValues: {"used-0": 100_000, "used-1": 20_000, since: 10_000, buffer: 33_000},
			barTotal: 1_000_000,
			usedTokens: 130_000,
			usedPct: 13,
		});
	});

	it("takes the remainder out of the buffer once Free space is exhausted", () => {
		const b = breakdown([
			{name: "Messages", tokens: 950_000, kind: "used"},
			{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
			{name: "Free space", tokens: 5_000, kind: "free"},
		]);
		const {legend, meterValues, usedTokens, usedPct} = buildContextLegend(b, 970_000);
		expect({legend, meterValues, usedTokens, usedPct}).toStrictEqual({
			legend: [
				{name: "Messages", tokens: 950_000, kind: "used", id: "used-0", meterSeries: "used-0", color: null},
				{name: "Since last update", tokens: 20_000, id: "since", meterSeries: "since", color: null},
				{
					name: "Autocompact buffer",
					tokens: 18_000,
					kind: "buffer",
					id: "buffer",
					meterSeries: "buffer",
					color: null,
				},
				{
					name: "Free space",
					tokens: 0,
					kind: "free",
					id: "free",
					meterSeries: null,
					color: "var(--chart-reference-tint)",
				},
			],
			meterValues: {"used-0": 950_000, since: 20_000, buffer: 18_000},
			usedTokens: 970_000,
			usedPct: 97,
		});
	});

	it("excludes deferred rows from the used tokens", () => {
		const b = breakdown([
			{name: "Messages", tokens: 100_000, kind: "used"},
			{name: "MCP tools", tokens: 41_000, kind: "deferred"},
			{name: "Free space", tokens: 900_000, kind: "free"},
		]);
		const {usedTokens, usedPct, barTotal} = buildContextLegend(b, null);
		expect({usedTokens, usedPct, barTotal}).toStrictEqual({usedTokens: 100_000, usedPct: 10, barTotal: 1_000_000});
	});

	it("falls back to the total tokens and percentage without Free space or a max", () => {
		const b = breakdown([{name: "Messages", tokens: 100_000, kind: "used"}], {
			totalTokens: 120_000,
			rawMaxTokens: 0,
			percentage: 12,
		});
		const {usedTokens, usedPct, barTotal} = buildContextLegend(b, null);
		expect({usedTokens, usedPct, barTotal}).toStrictEqual({usedTokens: 120_000, usedPct: 12, barTotal: 100_000});
	});
});

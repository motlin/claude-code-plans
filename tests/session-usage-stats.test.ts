import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import
{
	accumulateUsageRecord,
	buildSessionUsageStats,
	createUsageAccumulator,
	readSessionUsageStats,
	readSessionUsageStatsMemoized,
} from "../src/lib/session-usage-accumulator";
import
{
	EMPTY_SESSION_USAGE_STATS,
	formatNarrowDuration,
	formatTokensShort,
	type SessionUsageStats,
	SessionUsageStatsSchema,
	usageReport,
} from "../src/lib/session-usage-stats";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5";

interface Tokens
{
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

function assistant(id: string, model: string, tokens: Tokens, content: unknown[] = []): unknown
{
	return {
		type: "assistant",
		message:
		{
			id,
			model,
			content,
			usage:
			{
				input_tokens: tokens.input ?? 0,
				output_tokens: tokens.output ?? 0,
				cache_read_input_tokens: tokens.cacheRead ?? 0,
				cache_creation_input_tokens: tokens.cacheWrite ?? 0,
			},
		},
	};
}

function user(content: unknown, extra: Record<string, unknown> = {}): unknown
{
	return {
		type: "user",
		...extra,
		message:
		{
			role: "user",
			content,
		},
	};
}

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): unknown
{
	return {
		type: "tool_use",
		id,
		name,
		input,
	};
}

function toolResult(id: string, content: unknown): unknown
{
	return {
		type: "tool_result",
		tool_use_id: id,
		content,
	};
}

function stats(records: unknown[]): SessionUsageStats
{
	const state = createUsageAccumulator();
	for (const record of records) accumulateUsageRecord(state, record);
	return buildSessionUsageStats(state);
}

const roots: string[] = [];

afterEach(() =>
{
	for (const root of roots.splice(0))
		rmSync(
			root,
			{
				recursive: true,
				force: true,
			},
		);
});

function writeJsonl(path: string, records: unknown[]): void
{
	writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

describe("session usage accumulator", () =>
{
	it("counts a message id once at its per-field max, skips <synthetic>, and sums per model", () =>
	{
		expect(
			stats([
				assistant(
					"m1",
					OPUS,
					{
						input: 10,
						output: 5,
						cacheRead: 100,
						cacheWrite: 20,
					},
				),
				assistant(
					"m1",
					OPUS,
					{
						input: 10,
						output: 30,
						cacheRead: 100,
						cacheWrite: 20,
					},
				),
				assistant(
					"m2",
					SONNET,
					{
						input: 1,
						output: 2,
						cacheRead: 3,
						cacheWrite: 4,
					},
				),
				assistant(
					"m3",
					"<synthetic>",
					{
						input: 999,
					},
				),
				assistant(
					"m4",
					OPUS,
					{
						input: 5,
					},
				),
			]),
		).toEqual(
			{
				...EMPTY_SESSION_USAGE_STATS,
				usage:
				{
					[OPUS]:
					{
						input: 15,
						output: 30,
						cacheRead: 100,
						cacheWrite: 20,
					},
					[SONNET]:
					{
						input: 1,
						output: 2,
						cacheRead: 3,
						cacheWrite: 4,
					},
				},
			},
		);
	});

	it("reads the result, line changes and unknown-cost flag from the newest cost-state", () =>
	{
		expect(
			stats([
				{
					type: "cost-state",
					totalCostUSD: 1,
					totalLinesAdded: 1,
				},
				{
					type: "cost-state",
					totalCostUSD: 3.5,
					totalAPIDuration: 600_000,
					totalDuration: 1_800_000,
					totalLinesAdded: 12,
					totalLinesRemoved: 3,
					hasUnknownModelCost: true,
					modelUsage:
					{
						[OPUS]:
						{
							costUSD: 3,
							webSearchRequests: 2,
						},
						[HAIKU]:
						{
							costUSD: 0.5,
						},
					},
				},
			]),
		).toEqual(
			{
				...EMPTY_SESSION_USAGE_STATS,
				result:
				{
					costUSD: 3.5,
					apiMs: 600_000,
					wallMs: 1_800_000,
					perModel:
					{
						[OPUS]:
						{
							costUSD: 3,
							webSearch: 2,
						},
						[HAIKU]:
						{
							costUSD: 0.5,
							webSearch: 0,
						},
					},
				},
				lineChanges:
				{
					added: 12,
					removed: 3,
				},
				hasUnknownModelCost: true,
			},
		);
	});

	it("charges requests after a slash-command prompt to that skill, but not built-ins like /compact or /usage", () =>
	{
		const result = stats([
			user("<command-message>review</command-message>\n<command-name>/review</command-name>"),
			assistant(
				"a",
				OPUS,
				{
					input: 1,
				},
			),
			user("/compact"),
			assistant(
				"b",
				OPUS,
				{
					input: 1,
				},
			),
			user("<command-name>/usage</command-name>"),
			assistant(
				"c",
				OPUS,
				{
					input: 2,
				},
			),
		]);
		expect(result.attribution).toEqual(
			{
				subagents: [],
				skills: [
					{
						name: "review",
						pct: 25,
					},
				],
				mcpServers: [],
			},
		);
	});

	it("charges an MCP tool result's quarter-character tokens ×10 × the last model's family to its server", () =>
	{
		const result = stats([
			assistant("a", OPUS, {}, [toolUse("t1", "mcp__github__search")]),
			user([toolResult("t1", "x".repeat(400))]),
			assistant(
				"b",
				OPUS,
				{
					input: 100,
				},
			),
		]);
		expect(result.attribution).toEqual(
			{
				subagents: [],
				skills: [],
				mcpServers: [
					{
						name: "github",
						pct: 50,
					},
				],
			},
		);
	});

	it("keeps whole-percent shares above zero, largest first, at most 8", () =>
	{
		const records: unknown[] = [];
		for (let index = 0; index < 9; index++)
			records.push(
				user(`/skill${index}`),
				assistant(
					`m${index}`,
					OPUS,
					{
						input: 10,
					},
				),
			);
		records.push(
			user("/tiny"),
			assistant(
				"tiny",
				OPUS,
				{
					cacheRead: 1,
				},
			),
		);
		expect(stats(records).attribution.skills).toEqual(
			Array.from(
				{
					length: 8,
				},
				(_, index) => (
				{
					name: `skill${index}`,
					pct: 11,
				}),
			),
		);
	});

	it("charges subagent transcripts to their Agent call's subagent_type and leaves their tokens out of the models", async () =>
	{
		const root = mkdtempSync(join(tmpdir(), "usage-stats-"));
		roots.push(root);
		const transcript = join(root, "session.jsonl");
		const subagents = join(root, "session", "subagents");
		mkdirSync(
			subagents,
			{
				recursive: true,
			},
		);
		writeJsonl(transcript, [
			assistant(
				"top",
				OPUS,
				{
					input: 100,
				},
				[
					toolUse(
						"toolu_A",
						"Agent",
						{
							subagent_type: "Explore",
						},
					),
				],
			),
		]);
		writeJsonl(join(subagents, "agent-x.jsonl"), [
			assistant(
				"sub1",
				HAIKU,
				{
					input: 100,
				},
			),
		]);
		writeFileSync(
			join(subagents, "agent-x.meta.json"),
			JSON.stringify(
				{
					agentType: "general-purpose",
					toolUseId: "toolu_A",
				},
			),
		);
		writeJsonl(join(subagents, "agent-y.jsonl"), [
			assistant(
				"sub2",
				SONNET,
				{
					input: 100,
				},
			),
		]);

		const result = await readSessionUsageStats(transcript);

		expect(SessionUsageStatsSchema.parse(result)).toEqual(
			{
				...EMPTY_SESSION_USAGE_STATS,
				usage:
				{
					[OPUS]:
					{
						input: 100,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
					},
				},
				attribution:
				{
					subagents: [
						{
							name: "subagent",
							pct: 33,
						},
						{
							name: "Explore",
							pct: 11,
						},
					],
					skills: [],
					mcpServers: [],
				},
			},
		);
	});

	it("gives the empty shape for an empty or missing transcript", async () =>
	{
		const root = mkdtempSync(join(tmpdir(), "usage-stats-"));
		roots.push(root);
		const transcript = join(root, "empty.jsonl");
		writeFileSync(transcript, "");

		expect([
			await readSessionUsageStats(transcript),
			await readSessionUsageStatsMemoized(join(root, "missing.jsonl")),
		]).toEqual([EMPTY_SESSION_USAGE_STATS, EMPTY_SESSION_USAGE_STATS]);
	});
});

describe("formatTokensShort", () =>
{
	it("abbreviates like upstream's ic, rolling a unit over at 1000", () =>
	{
		expect([999, 1000, 1049, 12_345, 999_999, 1_000_000, 3_450_000, 1.2e9].map(formatTokensShort)).toEqual([
			"999",
			"1K",
			"1K",
			"12.3K",
			"1M",
			"1M",
			"3.5M",
			"1.2B",
		]);
	});
});

describe("formatNarrowDuration", () =>
{
	it("shows hours with minutes, minutes with seconds, or at least one second", () =>
	{
		expect([65_000, 3_900_000, 400, 8_000].map(formatNarrowDuration)).toEqual(["1m 5s", "1h 5m", "1s", "8s"]);
	});
});

describe("usageReport", () =>
{
	const base =
	{
		generatedAt: "2026-11-06T12:00:00.000Z",
		userAgent: "UA",
		windows: [
			{
				key: "seven_day",
				utilization: 51.4,
				resetsAt: "2026-11-08T15:00:00Z",
				expires: false,
			},
		],
		planError: false,
		sessionUsage:
		{
			[OPUS]:
			{
				input: 1200,
				output: 3000,
				cacheRead: 12_345,
				cacheWrite: 0,
			},
		},
		resultStats:
		{
			costUSD: 3.456,
			apiMs: 600_000,
			wallMs: 1_800_000,
		},
		modelName: (model: string) => (model === OPUS ? "Opus 5.5" : model),
	};

	it("lists plan limits and the session like upstream's xB", () =>
	{
		expect(usageReport(base)).toBe(
			[
				"Claude Code usage report (2026-11-06T12:00:00.000Z)",
				"Client: UA",
				"",
				"Plan limits:",
				"- seven_day: 51% (resets 2026-11-08T15:00:00Z)",
				"",
				"Session:",
				"- Opus 5.5: 1.2K in / 3K out / 12.3K cache read / 0 cache write",
				"- Cost: $3.46 | API 10m | Wall 30m",
			].join("\n"),
		);
	});

	it("says why limits are missing and drops an empty Session block", () =>
	{
		const empty =
		{
			...base,
			sessionUsage: {},
			resultStats: null,
		};
		expect([
			usageReport(
				{
					...empty,
					planError: true,
				},
			),
			usageReport(
				{
					...empty,
					windows: [],
				},
			),
		]).toEqual([
			"Claude Code usage report (2026-11-06T12:00:00.000Z)\nClient: UA\n\nPlan limits:\n- unavailable (limits fetch failed)",
			"Claude Code usage report (2026-11-06T12:00:00.000Z)\nClient: UA\n\nPlan limits:\n- none reported",
		]);
	});
});

import {readdir, readFile, stat} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {CostStateRecordSchema} from "./runtime-schemas";
import
{
	type AttributionRow,
	EMPTY_SESSION_USAGE_STATS,
	type ModelTokens,
	type SessionUsageResult,
	type SessionUsageStats,
} from "./session-usage-stats";
import {SYNTHETIC_MODEL} from "./model-name";
import {forEachTranscriptLine} from "./transcript-stream";

// Server-side port of upstream's `epitaxyUsageStats` accumulator (ca288e1f2 `p`/`m`/`h`/`g`). Upstream reads SDK
// `result` records; a local CLI transcript has none, so the result, line changes and unknown-cost flag come from its
// newest `cost-state` record, and subagent requests come from the `subagents/agent-*.jsonl` files beside it.

type RecordLike = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordLike
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: RecordLike, key: string): number
{
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: RecordLike | undefined, key: string): string | undefined
{
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

/** Upstream's `t`: opus 5, haiku 1, anything else 3. */
function familyWeight(model: string | undefined): number
{
	const lower = (model ?? "").toLowerCase();
	if (lower.includes("opus")) return 5;
	if (lower.includes("haiku")) return 1;
	return 3;
}

const USAGE_FIELDS = [
	"input_tokens",
	"output_tokens",
	"cache_read_input_tokens",
	"cache_creation_input_tokens",
] as const;
type UsageField = (typeof USAGE_FIELDS)[number];
type UsageCounts = Record<UsageField, number>;

/** Upstream's `n`: a request's relative cost, for attribution shares only. */
function costWeight(usage: UsageCounts, model: string): number
{
	return (
		(usage.cache_read_input_tokens +
			usage.input_tokens * 10 +
			usage.cache_creation_input_tokens * 12.5 +
			usage.output_tokens * 50) *
		familyWeight(model)
	);
}

/** Upstream's `r`: an image or document block's token estimate. */
const MEDIA_TOKENS = 1600;

/** Upstream's `i`: a tool result's token estimate, a quarter of its characters. */
function resultTokens(content: unknown): number
{
	if (typeof content === "string") return Math.ceil(content.length / 4);
	if (Array.isArray(content))
	{
		let total = 0;
		for (const block of content as unknown[])
		{
			const record = isRecord(block) ? block : undefined;
			const type = record?.["type"];
			if (type === "text") total += Math.ceil((stringField(record, "text") ?? "").length / 4);
			else if (type === "image" || type === "document") total += MEDIA_TOKENS;
			else total += Math.ceil(JSON.stringify(block ?? "").length / 4);
		}
		return total;
	}
	return Math.ceil(JSON.stringify(content ?? "").length / 4);
}

const MCP_SERVER = /^mcp__([^_]+(?:_[^_]+)*)__/;

/** Upstream's `o`: built-in commands that never count as the active skill. */
const BUILT_IN_COMMANDS = new Set([
	"usage",
	"cost",
	"compact",
	"clear",
	"context",
	"init",
	"resume",
	"export",
	"doctor",
	"stats",
	"todos",
	"model",
	"config",
	"help",
	"memory",
	"mcp",
	"agents",
	"permissions",
	"hooks",
]);

interface ToolUse
{
	name: string;
	subagentType: string | undefined;
}

export interface UsageAccumulator
{
	perModelUsage: Record<string, ModelTokens>;
	usageByMessageId: Map<string, UsageCounts>;
	toolById: Map<string, ToolUse>;
	totalCost: number;
	bySubagent: Map<string, number>;
	bySkill: Map<string, number>;
	byMcp: Map<string, number>;
	activeSkill: string | null;
	lastTopModel: string | undefined;
	costState: RecordLike | null;
}

export function createUsageAccumulator(): UsageAccumulator
{
	return {
		perModelUsage: {},
		usageByMessageId: new Map(),
		toolById: new Map(),
		totalCost: 0,
		bySubagent: new Map(),
		bySkill: new Map(),
		byMcp: new Map(),
		activeSkill: null,
		lastTopModel: undefined,
		costState: null,
	};
}

function add(map: Map<string, number>, key: string, value: number): void
{
	map.set(key, (map.get(key) ?? 0) + value);
}

function usageCounts(usage: RecordLike): UsageCounts
{
	return {
		input_tokens: numberField(usage, "input_tokens"),
		output_tokens: numberField(usage, "output_tokens"),
		cache_read_input_tokens: numberField(usage, "cache_read_input_tokens"),
		cache_creation_input_tokens: numberField(usage, "cache_creation_input_tokens"),
	};
}

/** Upstream's `f`: what this record adds over what its message id already counted, keeping the per-field max. */
function usageDelta(state: UsageAccumulator, messageId: string | undefined, usage: UsageCounts): UsageCounts
{
	if (messageId === undefined || messageId === "") return usage;
	const seen = state.usageByMessageId.get(messageId);
	const max =
	{
		...usage,
	};
	const delta =
	{
		...usage,
	};
	for (const field of USAGE_FIELDS)
	{
		const before = seen?.[field] ?? 0;
		max[field] = Math.max(before, usage[field]);
		delta[field] = max[field] - before;
	}
	state.usageByMessageId.set(messageId, max);
	return delta;
}

/** Upstream's prompt text: a string content, or its first text block. */
function promptText(content: unknown): string
{
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const block of content as unknown[])
		if (isRecord(block) && block["type"] === "text") return stringField(block, "text") ?? "";
	return "";
}

/**
 * The slash command a prompt runs: upstream's `/name` or `<command-name>/name</command-name>`. The local CLI writes
 * `<command-message>` before `<command-name>`, so the tag may follow it.
 */
function promptCommand(text: string): string | undefined
{
	const typed = /^\/(\w[\w:-]*)(?:\s|$)/.exec(text)?.[1];
	if (typed !== undefined) return typed;
	if (!text.startsWith("<command-")) return undefined;
	return /<command-name>\/?(\w[\w:-]*)<\/command-name>/.exec(text)?.[1];
}

/** Who a subagent transcript's requests are charged to: its Agent call's `subagent_type`, else the tool or meta type. */
export interface SubagentSource
{
	toolUseId: string | undefined;
	agentType: string | undefined;
}

function subagentKey(state: UsageAccumulator, source: SubagentSource): string
{
	const tool = source.toolUseId === undefined ? undefined : state.toolById.get(source.toolUseId);
	return tool?.subagentType ?? tool?.name ?? source.agentType ?? "subagent";
}

function accumulateAssistant(state: UsageAccumulator, record: RecordLike, subagent: SubagentSource | null): void
{
	const message = isRecord(record["message"]) ? record["message"] : undefined;
	const model = stringField(message, "model");
	const real = model !== undefined && model !== "" && model !== SYNTHETIC_MODEL;
	const usage =
		real && isRecord(message?.["usage"])
			? usageDelta(state, stringField(message, "id"), usageCounts(message["usage"]))
			: undefined;
	if (subagent === null && usage !== undefined)
	{
		const tokens = (state.perModelUsage[model ?? ""] ??=
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		tokens.input += usage.input_tokens;
		tokens.output += usage.output_tokens;
		tokens.cacheRead += usage.cache_read_input_tokens;
		tokens.cacheWrite += usage.cache_creation_input_tokens;
	}
	const content = message?.["content"];
	if (subagent === null && Array.isArray(content))
		for (const block of content as unknown[])
		{
			if (!isRecord(block) || block["type"] !== "tool_use") continue;
			const id = stringField(block, "id");
			if (id === undefined) continue;
			const input = isRecord(block["input"]) ? block["input"] : undefined;
			state.toolById.set(
				id,
				{
					name: stringField(block, "name") ?? "",
					subagentType: stringField(input, "subagent_type"),
				},
			);
		}
	if (usage === undefined || model === undefined) return;
	const cost = costWeight(usage, model);
	state.totalCost += cost;
	if (subagent === null)
	{
		state.lastTopModel = model;
		if (state.activeSkill !== null) add(state.bySkill, state.activeSkill, cost);
	}
	else add(state.bySubagent, subagentKey(state, subagent), cost);
}

function accumulateUser(state: UsageAccumulator, record: RecordLike): void
{
	const message = isRecord(record["message"]) ? record["message"] : undefined;
	const content = message?.["content"];
	const blocks = Array.isArray(content) ? (content as unknown[]) : [];
	const meta = record["isSynthetic"] === true || record["isMeta"] === true;
	const toolResults =
		blocks.length > 0 && blocks.every((block) => isRecord(block) && block["type"] === "tool_result");
	if (!meta && !toolResults)
	{
		const command = promptCommand(promptText(content));
		state.activeSkill = command !== undefined && !BUILT_IN_COMMANDS.has(command) ? command : null;
	}
	for (const block of blocks)
	{
		if (!isRecord(block) || block["type"] !== "tool_result") continue;
		const toolUseId = stringField(block, "tool_use_id");
		const server = MCP_SERVER.exec(state.toolById.get(toolUseId ?? "")?.name ?? "")?.[1];
		if (server === undefined) continue;
		const cost = resultTokens(block["content"]) * 10 * familyWeight(state.lastTopModel);
		add(state.byMcp, server, cost);
		state.totalCost += cost;
	}
}

/**
 * Upstream's `m` for one record. `subagent` is null for the session's own records and names the Agent call for a
 * subagent transcript's; upstream counts only top-level tool results and prompts, so subagent user records add nothing.
 */
export function accumulateUsageRecord(
	state: UsageAccumulator,
	record: unknown,
	subagent: SubagentSource | null = null,
): void
{
	if (!isRecord(record)) return;
	switch (record["type"])
	{
		case "assistant":
			accumulateAssistant(state, record, subagent);
			break;
		case "user":
			if (subagent === null) accumulateUser(state, record);
			break;
		case "cost-state":
			if (subagent === null) state.costState = record;
			break;
		default:
			break;
	}
}

/** Upstream's `h`: whole-percent shares above zero, largest first, at most 8. */
function shares(values: ReadonlyMap<string, number>, total: number): AttributionRow[]
{
	if (total <= 0) return [];
	const rows: AttributionRow[] = [];
	for (const [name, value] of values)
	{
		const pct = Math.round((value / total) * 100);
		if (pct > 0)
			rows.push(
				{
					name,
					pct,
				},
			);
	}
	return rows.toSorted((a, b) => b.pct - a.pct).slice(0, 8);
}

/** Upstream's `g`, with the result read from the newest `cost-state`. */
export function buildSessionUsageStats(state: UsageAccumulator): SessionUsageStats
{
	const usage: Record<string, ModelTokens> = {};
	for (const [model, tokens] of Object.entries(state.perModelUsage))
		usage[model] =
		{
			...tokens,
		};
	const parsed = state.costState === null ? null : CostStateRecordSchema.safeParse(state.costState);
	const cost = parsed?.success === true ? parsed.data : null;
	let result: SessionUsageResult | null = null;
	if (cost !== null)
	{
		const perModel: SessionUsageResult["perModel"] = {};
		for (const [model, modelUsage] of Object.entries(cost.modelUsage ?? {}))
			perModel[model] =
			{
				costUSD: modelUsage.costUSD ?? 0,
				webSearch: modelUsage.webSearchRequests ?? 0,
			};
		result =
		{
			costUSD: cost.totalCostUSD ?? 0,
			apiMs: cost.totalAPIDuration ?? 0,
			wallMs: cost.totalDuration ?? 0,
			perModel,
		};
	}
	return {
		usage,
		result,
		attribution:
		{
			subagents: shares(state.bySubagent, state.totalCost),
			skills: shares(state.bySkill, state.totalCost),
			mcpServers: shares(state.byMcp, state.totalCost),
		},
		lineChanges:
		{
			added: cost?.totalLinesAdded ?? 0,
			removed: cost?.totalLinesRemoved ?? 0,
		},
		hasUnknownModelCost: cost?.hasUnknownModelCost ?? false,
	};
}

function parseLine(line: string): unknown
{
	try
	{
		return JSON.parse(line) as unknown;
	}
	catch
	{
		return null;
	}
}

/** Feeds every record of one transcript file; an unreadable file adds nothing. */
async function accumulateFile(state: UsageAccumulator, path: string, subagent: SubagentSource | null): Promise<void>
{
	try
	{
		await forEachTranscriptLine(path, (line) =>
		{
			accumulateUsageRecord(state, parseLine(line), subagent);
		});
	}
	catch
	{
		// A transcript that vanished or can't be read contributes nothing.
	}
}

async function readSubagentSource(metaPath: string): Promise<SubagentSource>
{
	try
	{
		const meta = JSON.parse(await readFile(metaPath, "utf-8")) as unknown;
		if (isRecord(meta))
			return {
				toolUseId: stringField(meta, "toolUseId"),
				agentType: stringField(meta, "agentType"),
			};
	}
	catch
	{
		// A missing meta file leaves the subagent unnamed.
	}
	return {
		toolUseId: undefined,
		agentType: undefined,
	};
}

/** `<dir>/<id>.jsonl` keeps its Agent-tool transcripts in `<dir>/<id>/subagents/agent-*.jsonl`. */
function subagentsDir(transcriptPath: string): string
{
	return join(dirname(transcriptPath), basename(transcriptPath, ".jsonl"), "subagents");
}

async function subagentFiles(transcriptPath: string): Promise<string[]>
{
	const dir = subagentsDir(transcriptPath);
	try
	{
		return (await readdir(dir))
			.filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
			.toSorted()
			.map((name) => join(dir, name));
	}
	catch
	{
		return [];
	}
}

/** The `/usage` card's session stats for a transcript and its subagent transcripts. */
export async function readSessionUsageStats(transcriptPath: string): Promise<SessionUsageStats>
{
	const state = createUsageAccumulator();
	await accumulateFile(state, transcriptPath, null);
	for (const file of await subagentFiles(transcriptPath))
		await accumulateFile(state, file, await readSubagentSource(file.replace(/\.jsonl$/, ".meta.json")));
	return buildSessionUsageStats(state);
}

const MEMO_LIMIT = 8;
const memo = new Map<string, SessionUsageStats>();

/** What changes when the session or one of its subagents writes: every file's size and mtime. */
async function filesVersion(transcriptPath: string): Promise<string | null>
{
	const files = [transcriptPath, ...(await subagentFiles(transcriptPath))];
	try
	{
		const stats = await Promise.all(files.map(async (file) => stat(file)));
		return JSON.stringify(files.map((file, index) => [file, stats[index]?.size, stats[index]?.mtimeMs]));
	}
	catch
	{
		return null;
	}
}

/** `readSessionUsageStats`, memoized until the transcript or a subagent transcript changes. */
export async function readSessionUsageStatsMemoized(transcriptPath: string): Promise<SessionUsageStats>
{
	const version = await filesVersion(transcriptPath);
	if (version === null) return EMPTY_SESSION_USAGE_STATS;
	const cached = memo.get(version);
	if (cached !== undefined) return cached;
	const stats = await readSessionUsageStats(transcriptPath);
	memo.set(version, stats);
	for (const oldest of memo.keys())
	{
		if (memo.size <= MEMO_LIMIT) break;
		memo.delete(oldest);
	}
	return stats;
}

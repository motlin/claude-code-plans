import {ContextUsageTwinSchema, type ContextUsageTwin} from "./schemas";

export type ContextCategoryKind = ContextUsageTwin["categories"][number]["kind"];

/** Upstream's `getContextUsage` breakdown, as the session rail's Context card renders it. */
export interface ContextBreakdown {
	categories: {name: string; tokens: number; kind: ContextCategoryKind}[];
	totalTokens: number;
	rawMaxTokens: number;
	percentage: number;
	mcpTools: {name: string; serverName: string; tokens: number}[];
	memoryFiles: {path: string; type: string; tokens: number}[];
	agents: {agentType: string; source: string; tokens: number}[];
	fetchedAt: string;
	/** `context-command`: the twin a `/context` run persists. `mod`: a CLI mod's per-turn mirror. */
	source: "context-command" | "mod";
}

export function breakdownFromTwin(twin: ContextUsageTwin, fetchedAt: string): ContextBreakdown {
	return {
		categories: twin.categories.map(({name, tokens, kind}) => ({name, tokens, kind})),
		totalTokens: twin.total_tokens,
		rawMaxTokens: twin.raw_max_tokens,
		percentage: twin.percentage,
		mcpTools: twin.mcp_tools.map((tool) => ({name: tool.name, serverName: tool.server_name, tokens: tool.tokens})),
		memoryFiles: twin.memory_files.map(({path, type, tokens}) => ({path, type, tokens})),
		agents: twin.agents.map((agent) => ({agentType: agent.agent_type, source: agent.source, tokens: agent.tokens})),
		fetchedAt,
		source: "context-command",
	};
}

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A compaction or `/clear` resets the context, so any earlier breakdown is stale (upstream's `contextResets`). */
function isContextReset(record: RecordLike): boolean {
	if (record["type"] !== "system") return false;
	if (record["subtype"] === "compact_boundary") return true;
	const commandRun = record["commandRun"];
	return isRecord(commandRun) && commandRun["command"] === "clear";
}

/** The newest `/context` twin's breakdown, or null when none exists or a later reset made it stale. */
export function latestBreakdown(records: readonly unknown[]): ContextBreakdown | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (!isRecord(record)) continue;
		if (isContextReset(record)) return null;
		if (record["type"] !== "system" || record["contextUsage"] === undefined) continue;
		const parsed = ContextUsageTwinSchema.safeParse(record["contextUsage"]);
		if (!parsed.success) continue;
		const timestamp = record["timestamp"];
		return breakdownFromTwin(parsed.data, typeof timestamp === "string" ? timestamp : "");
	}
	return null;
}

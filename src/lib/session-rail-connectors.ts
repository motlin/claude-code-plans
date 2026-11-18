import type {McpServerSummary} from "./api/customize";
import type {SessionMcpStatus} from "./api/sessions";
import {configNameForSession} from "./customize/session-mcp-rows";

/**
 * Upstream's per-row connector states (`ab` in c8b5c2821). Locally, "failed" comes
 * from the session's last full deferred-tools delta and "unavailable" has no source.
 */
export type ConnectorState = "failed" | "needs-auth" | "unavailable" | "off";

export interface ConnectorRow
{
	id: string;
	/** The server's name, which the letter tile takes its first character from. */
	name: string;
	label: string;
	state: ConnectorState | undefined;
}

export interface ConnectorCounts
{
	count: number;
	needReconnect: number;
	/** Off (and, upstream, unavailable) servers: listed but not connected. */
	unavailable: number;
}

/** Upstream's `bM`: only a lowercase slug is sentence-cased. */
const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

/** Upstream's `x6`: the two built-in servers shown under their product names. */
const PRODUCT_NAMES: Readonly<Record<string, string>> =
{
	"claude-in-chrome": "Claude in Chrome",
	"computer-use": "Computer use",
};

/** Upstream's `jk`: split camelCase and `-`/`_`/space, lowercase every word, capitalise the first. */
function sentenceCase(name: string): string
{
	const words = name
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((word) => word.toLowerCase());
	const [first, ...rest] = words;
	if (first === undefined) return name;
	return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** Upstream's `xM`: sentence-case a slug, leave any other name as written. */
function slugLabel(name: string): string
{
	return SLUG.test(name) ? sentenceCase(name) : name;
}

/** Upstream's `SM` label: `plugin:<plugin>:<server>` reads as its server, other names map through `x6`. */
export function connectorLabel(name: string): string
{
	const pluginServer = /^plugin:[^:]+:(.+)$/.exec(name)?.[1];
	if (pluginServer !== undefined) return slugLabel(pluginServer);
	return slugLabel(PRODUCT_NAMES[name] ?? name);
}

/** One status per server, as upstream: Off wins, then needs-auth, then failed. */
function connectorState(
	server: McpServerSummary,
	cwd: string | null,
	failedNames: ReadonlySet<string>,
): ConnectorState | undefined
{
	if (cwd !== null && server.offIn.includes(cwd)) return "off";
	if (server.needsAuth) return "needs-auth";
	return failedNames.has(configNameForSession(server)) ? "failed" : undefined;
}

function needsAttention(row: ConnectorRow): boolean
{
	return row.state === "failed" || row.state === "needs-auth";
}

/**
 * The rail Connectors card rows for a session cwd: user-wide servers and the
 * cwd's own, kept when enabled or switched off for this project (upstream lists
 * those with "Off"). `failed` is the session's failed-server snapshot; a name
 * with no config row (a claude.ai connector) is dropped. Rows sort by server
 * name (upstream `T`), then failed and needs-auth rows move first (`ab`).
 */
export function connectorRows(
	servers: readonly McpServerSummary[],
	cwd: string | null,
	failed: SessionMcpStatus["failed"],
): ConnectorRow[]
{
	const failedNames = new Set(failed.map((entry) => entry.name));
	const rows: ConnectorRow[] = [];
	for (const server of servers.toSorted((a, b) => a.name.localeCompare(b.name)))
	{
		if (server.projectPath !== undefined && server.projectPath !== cwd) continue;
		const state = connectorState(server, cwd, failedNames);
		if (!server.enabled && state !== "off") continue;
		rows.push(
			{
				id: server.id,
				name: server.name,
				label: connectorLabel(server.name),
				state,
			},
		);
	}
	return [...rows.filter(needsAttention), ...rows.filter((row) => !needsAttention(row))];
}

/** Upstream's desktop `Vd` counts over the listed rows. */
export function connectorCounts(rows: readonly ConnectorRow[]): ConnectorCounts
{
	return {
		count: rows.length,
		needReconnect: rows.filter(needsAttention).length,
		unavailable: rows.filter((row) => row.state === "off" || row.state === "unavailable").length,
	};
}

/** Upstream's `uN` summary: "{n} to reconnect", otherwise "{connected} connected". */
export function connectorsSummary({count, needReconnect, unavailable}: ConnectorCounts): string
{
	if (needReconnect > 0) return `${needReconnect} to reconnect`;
	return `${Math.max(0, count - needReconnect - unavailable)} connected`;
}

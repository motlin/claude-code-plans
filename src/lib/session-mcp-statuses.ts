/**
 * Upstream's `/status` MCP servers row reads `[name, status]` pairs from the SDK's `system/init`
 * `mcp_servers`. Local transcripts have no init record; the same state is in the
 * `deferred_tools_delta` attachments, folded here.
 */

export type McpServerStatus = "connected" | "needs-auth" | "pending" | "failed";

/** A `failedMcpServers` entry: only the name is read. */
interface McpFailedServer
{
	readonly name: string;
	readonly errorCode?: string | undefined;
	readonly error?: string | undefined;
}

/** The delta fields the fold reads; everything else on the attachment is ignored. */
export interface McpStatusDelta
{
	addedNames?: readonly string[] | undefined;
	readdedNames?: readonly string[] | undefined;
	removedNames?: readonly string[] | undefined;
	failedMcpServers?: ReadonlyArray<McpFailedServer> | undefined;
	pendingMcpServers?: readonly string[] | undefined;
	needsAuthMcpServers?: readonly string[] | undefined;
}

/** The server segment a tool name carries: `mcp__<segment>__<tool>`. */
function toolSegment(serverName: string): string
{
	return serverName.replace(/[^A-Za-z0-9_-]/g, "_");
}

const MCP_TOOL_RE = /^mcp__(.+?)__/;

/**
 * The session's MCP servers as `[name, status]` pairs, from its deferred-tools deltas oldest first.
 * The failed, pending and needs-auth lists are snapshots: the last delta that defines one wins, so a
 * full re-announce (which omits them) keeps the previous one. Connected servers are the `mcp__` tool
 * segments still present, minus any that a snapshot names. Order: connected (sorted), needs-auth,
 * pending, failed.
 */
export function sessionMcpStatuses(deltas: readonly McpStatusDelta[]): Array<[string, McpServerStatus]>
{
	const tools = new Set<string>();
	let failed: readonly string[] = [];
	let pending: readonly string[] = [];
	let needsAuth: readonly string[] = [];
	for (const delta of deltas)
	{
		for (const name of delta.addedNames ?? []) tools.add(name);
		for (const name of delta.readdedNames ?? []) tools.add(name);
		for (const name of delta.removedNames ?? []) tools.delete(name);
		if (delta.failedMcpServers !== undefined) failed = delta.failedMcpServers.map((server) => server.name);
		if (delta.pendingMcpServers !== undefined) pending = delta.pendingMcpServers;
		if (delta.needsAuthMcpServers !== undefined) needsAuth = delta.needsAuthMcpServers;
	}
	const named = new Set([...failed, ...pending, ...needsAuth].map(toolSegment));
	const connected = new Set<string>();
	for (const tool of tools)
	{
		const segment = MCP_TOOL_RE.exec(tool)?.[1];
		if (segment !== undefined && !named.has(segment)) connected.add(segment);
	}
	return [
		...[...connected].toSorted().map((name): [string, McpServerStatus] => [name, "connected"]),
		...needsAuth.map((name): [string, McpServerStatus] => [name, "needs-auth"]),
		...pending.map((name): [string, McpServerStatus] => [name, "pending"]),
		...failed.map((name): [string, McpServerStatus] => [name, "failed"]),
	];
}

import type {McpServerSummary} from "../api/customize";
import type {SessionMcpStatus} from "../api/sessions";

/** Upstream's session-server `fault`: the row's description and its tooltip sentence. */
export interface McpServerFault
{
	name: string;
	sentence: string;
}

/**
 * The name the session's transcript reports a server under: the CLI names
 * plugin servers `plugin:<plugin>:<server>` without the marketplace.
 */
export function configNameForSession(server: Pick<McpServerSummary, "id" | "name" | "scope">): string
{
	if (server.scope !== "plugin") return server.name;
	const plugin = /^plugin:([^@:]+)/.exec(server.id)?.[1];
	return plugin === undefined ? server.name : `plugin:${plugin}:${server.name}`;
}

/**
 * Upstream's session-server `host` description: an http server's hostname, a
 * stdio server's executable file name, or the whole command when it names no path.
 */
export function hostDescription(server: Pick<McpServerSummary, "transport" | "urlOrCommand">): string
{
	if (server.transport !== "stdio")
	{
		try
		{
			return new URL(server.urlOrCommand).hostname;
		}
		catch
		{
			return server.urlOrCommand;
		}
	}
	const [executable = ""] = server.urlOrCommand.split(/\s+/);
	if (!executable.includes("/")) return server.urlOrCommand;
	return executable.slice(executable.lastIndexOf("/") + 1);
}

/**
 * The server's fault from the session's failed-server snapshot, or undefined
 * when it connected. A failure with no config row (a claude.ai connector) never matches.
 */
export function faultFor(
	server: Pick<McpServerSummary, "id" | "name" | "scope">,
	failed: SessionMcpStatus["failed"],
): McpServerFault | undefined
{
	const sessionName = configNameForSession(server);
	const entry = failed.find((candidate) => candidate.name === sessionName);
	if (entry === undefined) return undefined;
	const sentence = entry.error ?? "This server failed to connect.";
	return {
		name: entry.errorCode ?? "Failed to connect",
		sentence: entry.willRetry === undefined ? sentence : `${sentence} Will ${willRetryPhrase(entry.willRetry)}.`,
	};
}

/** A failed server's `willRetry` policy as a lowercase phrase: `on_reach` reads "retry on reach". */
export function willRetryPhrase(willRetry: string): string
{
	return `retry ${willRetry.replaceAll("_", " ")}`;
}

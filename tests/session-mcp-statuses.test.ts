import {describe, expect, it} from "vite-plus/test";
import {type McpStatusDelta, sessionMcpStatuses} from "../src/lib/session-mcp-statuses";

const FULL: McpStatusDelta =
{
	addedNames: ["mcp__sentry__search", "mcp__plugin_context7_context7__docs", "WebFetch"],
};

describe("sessionMcpStatuses", () =>
{
	it("folds deltas into upstream-style [name, status] pairs: connected sorted, then the snapshots", () =>
	{
		expect(
			{
				basic: sessionMcpStatuses([
					FULL,
					{
						failedMcpServers: [
							{
								name: "imcp",
							},
						],
						pendingMcpServers: [],
					},
				]),
				keptAcrossReannounce: sessionMcpStatuses([
					{
						failedMcpServers: [
							{
								name: "imcp",
								errorCode: "CONNECT_TIMEOUT",
							},
						],
					},
					FULL,
				]),
				cleared: sessionMcpStatuses([
					{
						failedMcpServers: [
							{
								name: "imcp",
							},
						],
					},
					FULL,
					{
						failedMcpServers: [],
					},
				]),
				removed: sessionMcpStatuses([
					FULL,
					{
						removedNames: ["mcp__sentry__search"],
					},
				]),
				readded: sessionMcpStatuses([
					{
						removedNames: ["mcp__x__a"],
					},
					{
						readdedNames: ["mcp__x__a"],
					},
				]),
				needsAuth: sessionMcpStatuses([
					{
						addedNames: ["mcp__claude_ai_Gmail__search", "mcp__sentry__search"],
						needsAuthMcpServers: ["claude.ai Gmail"],
						pendingMcpServers: ["github"],
					},
				]),
				failedPlugin: sessionMcpStatuses([
					{
						addedNames: ["mcp__plugin_1password_1password__read"],
						failedMcpServers: [
							{
								name: "plugin:1password:1password",
								errorCode: "ENOENT",
							},
						],
					},
				]),
				none: sessionMcpStatuses([]),
			},
		).toStrictEqual(
			{
				basic: [
					["plugin_context7_context7", "connected"],
					["sentry", "connected"],
					["imcp", "failed"],
				],
				keptAcrossReannounce: [
					["plugin_context7_context7", "connected"],
					["sentry", "connected"],
					["imcp", "failed"],
				],
				cleared: [
					["plugin_context7_context7", "connected"],
					["sentry", "connected"],
				],
				removed: [["plugin_context7_context7", "connected"]],
				readded: [["x", "connected"]],
				needsAuth: [
					["sentry", "connected"],
					["claude.ai Gmail", "needs-auth"],
					["github", "pending"],
				],
				failedPlugin: [["plugin:1password:1password", "failed"]],
				none: [],
			},
		);
	});
});

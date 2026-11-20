import {describe, expect, it} from "vite-plus/test";
import type {McpServerSummary} from "../src/lib/api/customize";
import {configNameForSession, faultFor, hostDescription} from "../src/lib/customize/session-mcp-rows";

function server(overrides: Partial<McpServerSummary> & Pick<McpServerSummary, "id" | "name">): McpServerSummary
{
	return {
		scope: "user",
		transport: "stdio",
		urlOrCommand: "npx server",
		enabled: true,
		envKeys: [],
		headerKeys: [],
		needsAuth: false,
		offIn: [],
		...overrides,
	};
}

describe("configNameForSession", () =>
{
	it("names plugin servers plugin:<plugin>:<server> and any other server by its name", () =>
	{
		expect([
			configNameForSession(
				{
					id: "plugin:1password@1password:1password",
					scope: "plugin",
					name: "1password",
				},
			),
			configNameForSession(
				{
					id: "user:imcp",
					scope: "user",
					name: "imcp",
				},
			),
		]).toStrictEqual(["plugin:1password:1password", "imcp"]);
	});
});

describe("hostDescription", () =>
{
	it("shows an http server's host and a stdio server's executable name, or the whole command", () =>
	{
		expect([
			hostDescription(
				{
					transport: "http",
					urlOrCommand: "https://mcp.sentry.dev/mcp",
				},
			),
			hostDescription(
				{
					transport: "http",
					urlOrCommand: "https://mcp.context7.com/mcp?client=x",
				},
			),
			hostDescription(
				{
					transport: "stdio",
					urlOrCommand: "/Applications/iMCP.app/Contents/MacOS/imcp-server",
				},
			),
			hostDescription(
				{
					transport: "stdio",
					urlOrCommand: "npx -y mcp-mail-server",
				},
			),
		]).toStrictEqual(["mcp.sentry.dev", "mcp.context7.com", "imcp-server", "npx -y mcp-mail-server"]);
	});
});

describe("faultFor", () =>
{
	const failed = [
		{
			name: "imcp",
			errorCode: "ENOENT",
			error: "spawn imcp ENOENT",
		},
		{
			name: "plugin:1password:1password",
			willRetry: "on_reach",
		},
		{
			name: "claude.ai Gmail",
			errorCode: "410",
		},
	];

	it("matches by the session name and falls back to upstream-style wording, or is undefined", () =>
	{
		expect([
			faultFor(
				server(
					{
						id: "user:imcp",
						name: "imcp",
					},
				),
				failed,
			),
			faultFor(
				server(
					{
						id: "plugin:1password@1password:1password",
						name: "1password",
						scope: "plugin",
					},
				),
				failed,
			),
			faultFor(
				server(
					{
						id: "user:sentry",
						name: "sentry",
					},
				),
				failed,
			),
		]).toStrictEqual([
			{
				name: "ENOENT",
				sentence: "spawn imcp ENOENT",
			},
			{
				name: "Failed to connect",
				sentence: "This server failed to connect. Will retry on reach.",
			},
			undefined,
		]);
	});
});

import {describe, expect, it} from "vite-plus/test";
import type {McpServerSummary} from "../src/lib/api/customize";
import {connectorCounts, connectorLabel, connectorRows, connectorsSummary} from "../src/lib/session-rail-connectors";

const CWD = "/p/klass";

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

describe("connectorLabel", () =>
{
	it("sentence-cases slug names, strips the plugin prefix and keeps any other name raw", () =>
	{
		expect(
			[
				"sentry",
				"gmail-cmotlin-imap",
				"plugin:context7:context7",
				"1password",
				"claude.ai Gmail",
				"myServer",
				"snake_case_name",
				"claude-in-chrome",
				"computer-use",
			].map(connectorLabel),
		).toStrictEqual([
			"Sentry",
			"Gmail cmotlin imap",
			"Context7",
			"1password",
			"claude.ai Gmail",
			"myServer",
			"Snake case name",
			"Claude in Chrome",
			"Computer use",
		]);
	});
});

describe("connectorRows", () =>
{
	const servers = [
		server(
			{
				id: "user:a",
				name: "a",
			},
		),
		server(
			{
				id: "user:b",
				name: "b",
				needsAuth: true,
			},
		),
		server(
			{
				id: "user:c",
				name: "c",
				needsAuth: true,
				offIn: [CWD],
			},
		),
		server(
			{
				id: "user:d",
				name: "d",
				offIn: ["/p/other"],
			},
		),
		server(
			{
				id: "user:e",
				name: "e",
				needsAuth: true,
			},
		),
		server(
			{
				id: "plugin:x@m:x",
				name: "x",
				scope: "plugin",
				enabled: false,
			},
		),
		server(
			{
				id: "local:/p/elsewhere:y",
				name: "y",
				scope: "local",
				projectPath: "/p/elsewhere",
			},
		),
		server(
			{
				id: `local:${CWD}:z`,
				name: "z",
				scope: "local",
				projectPath: CWD,
				enabled: false,
				offIn: [CWD],
			},
		),
	];

	it("keeps the cwd's servers, marks off and needs-auth, and sorts needs-auth first in source order", () =>
	{
		expect(connectorRows(servers, CWD, [])).toStrictEqual([
			{
				id: "user:b",
				name: "b",
				label: "B",
				state: "needs-auth",
			},
			{
				id: "user:e",
				name: "e",
				label: "E",
				state: "needs-auth",
			},
			{
				id: "user:a",
				name: "a",
				label: "A",
				state: undefined,
			},
			{
				id: "user:c",
				name: "c",
				label: "C",
				state: "off",
			},
			{
				id: "user:d",
				name: "d",
				label: "D",
				state: undefined,
			},
			{
				id: `local:${CWD}:z`,
				name: "z",
				label: "Z",
				state: "off",
			},
		]);
	});

	it("counts every row, the needs-auth ones and the off ones", () =>
	{
		expect(connectorCounts(connectorRows(servers, CWD, []))).toStrictEqual(
			{
				count: 6,
				needReconnect: 2,
				unavailable: 2,
			},
		);
	});
});

describe("connectorsSummary", () =>
{
	it("reads reconnects first, otherwise the servers neither off nor needing auth", () =>
	{
		expect(
			[
				{
					count: 6,
					needReconnect: 2,
					unavailable: 2,
				},
				{
					count: 5,
					needReconnect: 0,
					unavailable: 1,
				},
				{
					count: 2,
					needReconnect: 0,
					unavailable: 2,
				},
			].map(connectorsSummary),
		).toStrictEqual(["2 to reconnect", "4 connected", "0 connected"]);
	});
});

describe("connectorRows with the session's failed servers", () =>
{
	const servers = [
		server(
			{
				id: "user:zeta",
				name: "zeta",
				transport: "http",
			},
		),
		server(
			{
				id: "user:imcp",
				name: "imcp",
			},
		),
		server(
			{
				id: "plugin:1password@1password:1password",
				name: "1password",
				scope: "plugin",
				needsAuth: true,
			},
		),
		server(
			{
				id: "user:alpha",
				name: "alpha",
			},
		),
		server(
			{
				id: "user:beta",
				name: "beta",
				offIn: [CWD],
			},
		),
	];
	const failed = [
		{
			name: "imcp",
			errorCode: "CONNECT_TIMEOUT",
		},
		{
			name: "plugin:1password:1password",
			errorCode: "ENOENT",
		},
		{
			name: "beta",
		},
		{
			name: "claude.ai Cloudflare Developer Platform",
			errorCode: "410",
		},
	];

	it("marks failed servers, lets needs-auth and off win, drops unknown names and sorts each group by name", () =>
	{
		const rows = connectorRows(servers, CWD, failed);
		expect(
			{
				rows: rows.map(({label, state}) => (
				{
					label,
					state,
				})),
				counts: connectorCounts(rows),
				summary: connectorsSummary(connectorCounts(rows)),
				healthy: connectorsSummary(
					connectorCounts(
						connectorRows(
							servers.map((entry) => (
							{
								...entry,
								needsAuth: false,
							})),
							CWD,
							[],
						),
					),
				),
			},
		).toStrictEqual(
			{
				rows: [
					{
						label: "1password",
						state: "needs-auth",
					},
					{
						label: "Imcp",
						state: "failed",
					},
					{
						label: "Alpha",
						state: undefined,
					},
					{
						label: "Beta",
						state: "off",
					},
					{
						label: "Zeta",
						state: undefined,
					},
				],
				counts:
				{
					count: 5,
					needReconnect: 2,
					unavailable: 1,
				},
				summary: "2 to reconnect",
				healthy: "4 connected",
			},
		);
	});

	it("matches a failed plugin server by its CLI name", () =>
	{
		expect(
			connectorRows(
				[
					server(
						{
							id: "plugin:context7@market:context7",
							name: "context7",
							scope: "plugin",
						},
					),
				],
				CWD,
				[
					{
						name: "plugin:context7:context7",
					},
				],
			).map((row) => row.state),
		).toStrictEqual(["failed"]);
	});
});

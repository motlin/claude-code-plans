import {describe, expect, it} from "vite-plus/test";
import
{
	sanitizeStatusText,
	sessionStatusGroups,
	sessionStatusReport,
	type StatusSources,
	tildePath,
} from "../src/lib/session-status-card";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const SESSION_ID = "8f1c2d3e-4b5a-4c6d-8e7f-001122334455";

const NO_SOURCES: StatusSources =
{
	cliVersion: null,
	modelId: null,
	effort: null,
	fastMode: false,
	permissionMode: null,
	outputStyle: null,
	createdAt: null,
	now: NOW,
	forked: false,
	sessionId: null,
	cwd: null,
	homePath: null,
	additionalDirectories: [],
	mcpStatuses: null,
	dataFlowIncompleteCodes: null,
	email: null,
	planDetail: null,
	organizationName: null,
};

const FULL_SOURCES: StatusSources =
{
	cliVersion: "2.1.326",
	modelId: "claude-opus-4-7",
	effort: "high",
	fastMode: false,
	permissionMode: "acceptEdits",
	outputStyle: "Concise",
	createdAt: NOW - 10_000,
	now: NOW,
	forked: false,
	sessionId: SESSION_ID,
	cwd: "/Users/craig/projects/app",
	homePath: "/Users/craig",
	additionalDirectories: ["/Users/craig/a", "/tmp/b"],
	mcpStatuses: [
		["a", "connected"],
		["b", "connected"],
		["c", "connected"],
		["d", "connected"],
		["e", "connected"],
		["f", "connected"],
		["imcp", "failed"],
	],
	dataFlowIncompleteCodes: [9, 4],
	email: "craig@x.com",
	planDetail: "Max (20x)",
	organizationName: "Craig's Org",
};

describe("sessionStatusGroups", () =>
{
	it("builds upstream's Session, Environment and Account groups in order", () =>
	{
		expect(sessionStatusGroups(FULL_SOURCES)).toEqual([
			{
				id: "session",
				label: "Session",
				rows: [
					{
						id: "claudeCode",
						label: "Claude Code",
						value: "2.1.326",
					},
					{
						id: "model",
						label: "Model",
						value: "Opus 4.7 · High",
						fullValue: "claude-opus-4-7 · High",
					},
					{
						id: "permissions",
						label: "Permissions",
						value: "Accept edits",
					},
					{
						id: "outputStyle",
						label: "Output style",
						value: "Concise",
					},
					{
						id: "started",
						label: "Started",
						value: "You · now",
						fullValue: "You · 2026-11-06T11:59:50.000Z",
					},
					{
						id: "sessionId",
						label: "Session ID",
						value: SESSION_ID,
						copyable: true,
					},
				],
			},
			{
				id: "environment",
				label: "Environment",
				rows: [
					{
						id: "folder",
						label: "Folder",
						value: "~/projects/app",
						fullValue: "/Users/craig/projects/app",
					},
					{
						id: "extraFolders",
						label: "Additional folders",
						value: "~/a, /tmp/b",
						fullValue: "/Users/craig/a, /tmp/b",
					},
					{
						id: "mcp",
						label: "MCP servers",
						value: "6 connected (a, b, c, d, e, +1 more) · 1 failed (imcp)",
						fullValue: "6 connected (a, b, c, d, e, f) · 1 failed (imcp)",
					},
					{
						id: "dataFlow",
						label: "Data-flow ledger",
						value: "Incomplete (codes 9, 4)",
					},
				],
			},
			{
				id: "account",
				label: "Account",
				rows: [
					{
						id: "account",
						label: "Signed in as",
						value: "craig@x.com · Max (20x)",
					},
					{
						id: "organization",
						label: "Organization",
						value: "Craig's Org",
					},
				],
			},
		]);
	});

	it("adds Fast to the effort, labels a 1M window and keeps a model without effort bare", () =>
	{
		const rows = (sources: Partial<StatusSources>) =>
			sessionStatusGroups(
				{
					...NO_SOURCES,
					...sources,
				},
			)[0]?.rows;
		expect(
			{
				fast: rows(
					{
						modelId: "claude-opus-4-7",
						effort: "high",
						fastMode: true,
					},
				),
				window: rows(
					{
						modelId: "claude-opus-5-5[1m]",
						effort: "xhigh",
					},
				),
				bare: rows(
					{
						modelId: "claude-haiku-4-5-20251001",
					},
				),
			},
		).toEqual(
			{
				fast: [
					{
						id: "model",
						label: "Model",
						value: "Opus 4.7 · High · Fast",
						fullValue: "claude-opus-4-7 · High · Fast",
					},
				],
				window: [
					{
						id: "model",
						label: "Model",
						value: "Opus 5.5 1M · Extra-high",
						fullValue: "claude-opus-5-5[1m] · Extra-high",
					},
				],
				bare: [
					{
						id: "model",
						label: "Model",
						value: "Haiku 4.5",
						fullValue: "claude-haiku-4-5-20251001",
					},
				],
			},
		);
	});

	it("drops the default output style, dates an older start and marks a fork", () =>
	{
		const session = (sources: Partial<StatusSources>) =>
			sessionStatusGroups(
				{
					...NO_SOURCES,
					...sources,
				},
			)[0]?.rows;
		expect(
			{
				defaultStyle: session(
					{
						outputStyle: "default",
						permissionMode: "default",
					},
				),
				older: session(
					{
						createdAt: NOW - 3 * 3_600_000,
					},
				),
				forked: session(
					{
						createdAt: NOW - 90_000,
						forked: true,
					},
				),
			},
		).toEqual(
			{
				defaultStyle: [
					{
						id: "permissions",
						label: "Permissions",
						value: "Manual",
					},
				],
				older: [
					{
						id: "started",
						label: "Started",
						value: "You · 3 hours ago",
						fullValue: "You · 2026-11-06T09:00:00.000Z",
					},
				],
				forked: [
					{
						id: "started",
						label: "Started",
						value: "Forked · 2 minutes ago",
						fullValue: "Forked · 2026-11-06T11:58:30.000Z",
					},
				],
			},
		);
	});

	it("drops empty groups, the account row without an email and empty additional folders", () =>
	{
		expect(
			{
				none: sessionStatusGroups(NO_SOURCES),
				orgOnly: sessionStatusGroups(
					{
						...NO_SOURCES,
						planDetail: "Pro",
						organizationName: "Org",
						additionalDirectories: [],
					},
				),
				noServers: sessionStatusGroups(
					{
						...NO_SOURCES,
						mcpStatuses: [],
						dataFlowIncompleteCodes: [],
					},
				),
			},
		).toEqual(
			{
				none: [],
				noServers: [
					{
						id: "environment",
						label: "Environment",
						rows: [
							{
								id: "mcp",
								label: "MCP servers",
								value: "None",
								fullValue: "None",
							},
							{
								id: "dataFlow",
								label: "Data-flow ledger",
								value: "Incomplete",
							},
						],
					},
				],
				orgOnly: [
					{
						id: "account",
						label: "Account",
						rows: [
							{
								id: "organization",
								label: "Organization",
								value: "Org",
							},
						],
					},
				],
			},
		);
	});

	it("sanitizes every value, full value and hint like upstream's rE", () =>
	{
		expect(
			sessionStatusGroups(
				{
					...NO_SOURCES,
					outputStyle: "a\u0000 b  c​ d ",
				},
			),
		).toEqual([
			{
				id: "session",
				label: "Session",
				rows: [
					{
						id: "outputStyle",
						label: "Output style",
						value: "a b c d",
					},
				],
			},
		]);
	});
});

describe("status card helpers", () =>
{
	it("tilde-shortens only paths at or under home and sanitizes text", () =>
	{
		expect(
			{
				under: tildePath("/Users/craig/p", "/Users/craig"),
				home: tildePath("/Users/craig", "/Users/craig"),
				outside: tildePath("/tmp/x", "/Users/craig"),
				sibling: tildePath("/Users/craigx", "/Users/craig"),
				noHome: tildePath("/Users/craig/p", null),
				sanitized: sanitizeStatusText("\tx­\u0007y  "),
			},
		).toEqual(
			{
				under: "~/p",
				home: "~",
				outside: "/tmp/x",
				sibling: "/Users/craigx",
				noHome: "/Users/craig/p",
				sanitized: "x y",
			},
		);
	});
});

describe("sessionStatusReport", () =>
{
	it("writes upstream's plain-text report with full values and hints, skipping empty groups", () =>
	{
		expect(
			sessionStatusReport(
				[
					{
						id: "session",
						label: "Session",
						rows: [
							{
								id: "model",
								label: "Model",
								value: "Opus 4.7 · High",
								fullValue: "claude-opus-4-7 · High",
							},
							{
								id: "sessionId",
								label: "Session ID",
								value: SESSION_ID,
								copyable: true,
							},
						],
					},
					{
						id: "environment",
						label: "Environment",
						rows: [],
					},
					{
						id: "account",
						label: "Account",
						rows: [
							{
								id: "account",
								label: "Signed in as",
								value: "craig@x.com · Pro",
								hint: "Managed by your organization",
							},
						],
					},
				],
				"2026-11-06T12:00:00.000Z",
			),
		).toBe(
			[
				"Claude Code session info (2026-11-06T12:00:00.000Z)",
				"",
				"Session:",
				"- Model: claude-opus-4-7 · High",
				`- Session ID: ${SESSION_ID}`,
				"",
				"Account:",
				"- Signed in as: craig@x.com · Pro (Managed by your organization)",
			].join("\n"),
		);
	});
});

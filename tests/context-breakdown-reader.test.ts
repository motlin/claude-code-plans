import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {breakdownFromMirror, handleContextMirrorEvent, readContextMirror} from "../src/lib/context-breakdown-reader";
import {preferNewerBreakdown, type ContextBreakdown} from "../src/lib/context-breakdown";
import {ContextMirrorFileSchema} from "../src/lib/schemas";
import {DOMAIN_EVENTS} from "../src/lib/hook-events";
import {handleSessionContextBreakdownRequest} from "../src/routes/api/sessions.$id.context-breakdown";

const SESSION_ID = "051e340d-87b5-40dd-9084-c576d11a5147";

// What the ccb-context-mirror mod wrote on CLI 2.1.314, trimmed to a few rows and with paths anonymized.
const mirrorFile = {
	sessionId: SESSION_ID,
	fetchedAt: "2026-10-30T03:50:12.000Z",
	breakdown: {
		categories: [
			{name: "System prompt", tokens: 3410, color: "promptBorder", isDeferred: false, kind: "used"},
			{
				name: "MCP tools (deferred)",
				tokens: 120_982,
				color: "cyan_FOR_SUBAGENTS_ONLY",
				isDeferred: true,
				kind: "deferred",
			},
			{name: "Memory files", tokens: 434, color: "claude", isDeferred: false, kind: "used"},
			{name: "Messages", tokens: 12_211, color: "purple_FOR_SUBAGENTS_ONLY", isDeferred: false, kind: "used"},
			{name: "Autocompact buffer", tokens: 33_000, color: "inactive", isDeferred: false, kind: "buffer"},
			{name: "Free space", tokens: 934_699, color: "promptBorder", isDeferred: false, kind: "free"},
		],
		totalTokens: 31_301,
		maxTokens: 1_000_000,
		rawMaxTokens: 1_000_000,
		autocompactSource: "model-default",
		percentage: 3,
		model: "claude-haiku-5-5",
		memoryFiles: [{path: "/Users/alice/.claude/CLAUDE.md", type: "User", tokens: 434}],
		mcpTools: [{name: "mcp__claude_ai_Docs__batch", serverName: "claude_ai_Docs", tokens: 200, isLoaded: false}],
		agents: [{agentType: "caveman:cavecrew-builder", source: "plugin", tokens: 109}],
		slashCommands: {totalCommands: 13, includedCommands: 13, tokens: 1403},
		skills: {
			totalSkills: 2,
			includedSkills: 2,
			tokens: 492,
			skillFrontmatter: [
				{name: "dataviz", source: "built-in", tokens: 482},
				{name: "claude-reflect:reflect", source: "plugin", pluginName: "claude-reflect", tokens: 10},
			],
		},
		autoCompactThreshold: 967_000,
		isAutoCompactEnabled: true,
		apiUsage: {
			input_tokens: 2,
			output_tokens: 4,
			cache_creation_input_tokens: 20_945,
			cache_read_input_tokens: 11_354,
		},
	},
};

const expectedBreakdown: ContextBreakdown = {
	categories: [
		{name: "System prompt", tokens: 3410, kind: "used"},
		{name: "MCP tools (deferred)", tokens: 120_982, kind: "deferred"},
		{name: "Memory files", tokens: 434, kind: "used"},
		{name: "Messages", tokens: 12_211, kind: "used"},
		{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
		{name: "Free space", tokens: 934_699, kind: "free"},
	],
	totalTokens: 31_301,
	rawMaxTokens: 1_000_000,
	percentage: 3,
	mcpTools: [{name: "mcp__claude_ai_Docs__batch", serverName: "claude_ai_Docs", tokens: 200}],
	memoryFiles: [{path: "/Users/alice/.claude/CLAUDE.md", type: "User", tokens: 434}],
	agents: [{agentType: "caveman:cavecrew-builder", source: "plugin", tokens: 109}],
	fetchedAt: "2026-10-30T03:50:12.000Z",
	source: "mod",
};

describe("ContextMirrorFileSchema", () => {
	it("parses the file the mod writes", () => {
		expect(ContextMirrorFileSchema.parse(mirrorFile)).toStrictEqual(mirrorFile);
	});

	it("rejects an unknown key inside a category", () => {
		const drifted = structuredClone(mirrorFile);
		Object.assign(drifted.breakdown.categories[0] ?? {}, {weight: 1});
		expect(ContextMirrorFileSchema.safeParse(drifted).success).toBe(false);
	});

	it("parses a breakdown without the optional listings, before the first response", () => {
		const {slashCommands: _s, skills: _k, autoCompactThreshold: _a, ...rest} = mirrorFile.breakdown;
		const bare = {...mirrorFile, breakdown: {...rest, apiUsage: null}};
		expect(ContextMirrorFileSchema.parse(bare)).toStrictEqual(bare);
	});
});

describe("breakdownFromMirror", () => {
	it("maps the mod's file to the rail's breakdown, sourced from the mod", () => {
		expect(breakdownFromMirror(ContextMirrorFileSchema.parse(mirrorFile))).toStrictEqual(expectedBreakdown);
	});
});

describe("readContextMirror", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "context-mirror-"));
	});

	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it("reads and validates the session's mirror file", async () => {
		writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify(mirrorFile));
		expect(await readContextMirror(SESSION_ID, dir)).toStrictEqual(expectedBreakdown);
	});

	it("is null when the session has no mirror file", async () => {
		expect(await readContextMirror(SESSION_ID, dir)).toBeNull();
	});

	it("is null for a file that is not a mirror", async () => {
		writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify({sessionId: SESSION_ID}));
		expect(await readContextMirror(SESSION_ID, dir)).toBeNull();
	});

	it("never reads outside the directory for a session id that is a path", async () => {
		mkdirSync(join(dir, "nested"));
		writeFileSync(join(dir, "nested", "x.json"), JSON.stringify(mirrorFile));
		expect(await readContextMirror("../nested/x", join(dir, "nested", "deeper"))).toBeNull();
	});
});

describe("preferNewerBreakdown", () => {
	const fromCommand: ContextBreakdown = {
		...expectedBreakdown,
		source: "context-command",
		fetchedAt: "2026-10-30T03:00:00.000Z",
	};

	it("prefers the mod's breakdown when it is newer", () => {
		expect(preferNewerBreakdown(fromCommand, expectedBreakdown)).toStrictEqual(expectedBreakdown);
	});

	it("keeps a /context run that is newer than the mod's last write", () => {
		const newerCommand = {...fromCommand, fetchedAt: "2026-10-30T04:00:00.000Z"};
		expect(preferNewerBreakdown(newerCommand, expectedBreakdown)).toStrictEqual(newerCommand);
	});

	it("takes whichever exists", () => {
		expect([
			preferNewerBreakdown(null, expectedBreakdown),
			preferNewerBreakdown(fromCommand, null),
			preferNewerBreakdown(null, null),
		]).toStrictEqual([expectedBreakdown, fromCommand, null]);
	});
});

describe("handleContextMirrorEvent", () => {
	it("broadcasts the session whose mirror file changed, and claims only paths in the mirror directory", () => {
		const root = "/Users/alice/.claude/plugins/data/ccb-context-mirror/context";
		const broadcast = vi.fn<(type: string, data: Record<string, unknown>) => void>();
		const claimed = [
			handleContextMirrorEvent(`${root}/${SESSION_ID}.json`, root, broadcast),
			handleContextMirrorEvent(`${root}/.ccb-probe-1.tmp`, root, broadcast),
			handleContextMirrorEvent("/Users/alice/.claude/projects/p/s.json", root, broadcast),
			handleContextMirrorEvent(`${root}/${SESSION_ID}.json`, "", broadcast),
		];
		expect({claimed, calls: broadcast.mock.calls}).toStrictEqual({
			claimed: [true, true, false, false],
			calls: [[DOMAIN_EVENTS.SESSION_CONTEXT_BREAKDOWN_CHANGED, {sessionId: SESSION_ID}]],
		});
	});
});

describe("handleSessionContextBreakdownRequest", () => {
	it("answers the session's mirrored breakdown, or null for a session id that is not one", async () => {
		const readBreakdown = vi.fn<(sessionId: string) => Promise<ContextBreakdown | null>>(async () =>
			Promise.resolve(expectedBreakdown),
		);
		const responses = await Promise.all([
			handleSessionContextBreakdownRequest(SESSION_ID, {readBreakdown}),
			handleSessionContextBreakdownRequest("../etc", {readBreakdown}),
		]);
		expect({
			bodies: await Promise.all(responses.map(async (response) => response.json())),
			cache: responses.map((response) => response.headers.get("Cache-Control")),
			reads: readBreakdown.mock.calls,
		}).toStrictEqual({
			bodies: [expectedBreakdown, null],
			cache: ["private, max-age=0, must-revalidate", "private, max-age=0, must-revalidate"],
			reads: [[SESSION_ID]],
		});
	});
});

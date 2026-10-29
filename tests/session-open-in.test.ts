import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {handleOpenInFinder, type OpenInFinderDependencies} from "../src/lib/open-in-finder";
import {getSessionMenuItems, type SessionMenuCapability, type SessionMenuSession} from "../src/lib/session-menu-items";
import {claudeAiSessionUrl, sessionResumeCommand, vscodeFolderUrl} from "../src/lib/session-open-in";
import {readBridgeSession} from "../src/lib/sessions";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

const OPEN_IN: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
	"openLiveTerminal",
	"openTerminal",
	"openVsCode",
	"openFinder",
	"openClaudeAi",
]);

function session(overrides: Partial<SessionMenuSession> = {}): SessionMenuSession {
	return {
		title: "Fix the flaky test",
		pinned: false,
		readState: "read",
		archived: false,
		prUrl: null,
		hasLiveTerminal: false,
		forkDisabledReason: null,
		cwd: "/Users/alice/projects/alpha",
		bridgeSessionId: null,
		...overrides,
	};
}

function openInSubmenu(overrides: Partial<SessionMenuSession>) {
	const [first] = getSessionMenuItems(session(overrides), OPEN_IN, {surface: "row"});
	return first?.kind === "item" && first.id === "open-in" ? first.submenu : undefined;
}

describe("Open in ▸ submenu", () => {
	it("numbers every local target when a pane is live and a bridge session exists", () => {
		expect(openInSubmenu({hasLiveTerminal: true, bridgeSessionId: "cse_alice_100"})).toEqual([
			{kind: "item", id: "open-vscode", label: "VS Code", accelerator: "1"},
			{kind: "item", id: "open-terminal", label: "Terminal", accelerator: "2"},
			{kind: "item", id: "open-live-terminal", label: "Live terminal", accelerator: "3"},
			{kind: "item", id: "open-claude-ai", label: "claude.ai", accelerator: "4"},
			{kind: "item", id: "open-finder", label: "Finder", accelerator: "5"},
		]);
	});

	it("omits the live terminal and claude.ai without a pane or bridge session", () => {
		expect(openInSubmenu({})).toEqual([
			{kind: "item", id: "open-vscode", label: "VS Code", accelerator: "1"},
			{kind: "item", id: "open-terminal", label: "Terminal", accelerator: "2"},
			{kind: "item", id: "open-finder", label: "Finder", accelerator: "3"},
		]);
	});

	it("offers only claude.ai when the session has no known directory", () => {
		expect(openInSubmenu({cwd: null, bridgeSessionId: "cse_alice_100"})).toEqual([
			{kind: "item", id: "open-claude-ai", label: "claude.ai", accelerator: "1"},
		]);
	});

	it("has no Open in submenu without a directory, pane or bridge session", () => {
		expect(
			getSessionMenuItems(session({cwd: null}), OPEN_IN, {surface: "row"}).map((entry) =>
				entry.kind === "item" ? entry.id : "|",
			),
		).toEqual([]);
	});
});

describe("Open in targets", () => {
	it("builds the resume command from the session directory", () => {
		expect(sessionResumeCommand(SESSION_ID, "/Users/alice/projects/alpha")).toBe(
			`cd '/Users/alice/projects/alpha' && claude -r ${SESSION_ID}`,
		);
	});

	it("shell-escapes single quotes in the directory", () => {
		expect(sessionResumeCommand(SESSION_ID, "/Users/alice/it's here")).toBe(
			`cd '/Users/alice/it'\\''s here' && claude -r ${SESSION_ID}`,
		);
	});

	it("builds a vscode://file URL with each path segment encoded", () => {
		expect(vscodeFolderUrl("/Users/alice/my project/#1?")).toBe("vscode://file/Users/alice/my%20project/%231%3F");
	});

	it.each([
		["cse_alice_100", "https://claude.ai/code/session_alice_100"],
		["session_alice_100", "https://claude.ai/code/session_alice_100"],
		["alice_cse_100", "https://claude.ai/code/alice_cse_100"],
		["cse_alice/100?", "https://claude.ai/code/session_alice%2F100%3F"],
	])("links bridge session %s using its canonical claude.ai URL", (bridgeSessionId, expectedUrl) => {
		expect(claudeAiSessionUrl(bridgeSessionId)).toBe(expectedUrl);
	});
});

describe("readBridgeSession", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ccp-bridge-"));
	});

	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	function bridgeRecord(bridgeSessionId: string, lastSequenceNum: number) {
		return {
			type: "bridge-session",
			sessionId: SESSION_ID,
			bridgeSessionId,
			lastSequenceNum,
			ownerAccountUuid: "acct-alice-100",
			ownerOrganizationUuid: "org-alice-100",
		};
	}

	async function transcript(records: unknown[]): Promise<string> {
		const filePath = join(dir, `${SESSION_ID}.jsonl`);
		await writeFile(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
		return filePath;
	}

	it("returns the latest bridge-session record's id", async () => {
		const filePath = await transcript([
			{type: "user", message: {role: "user", content: "mentions bridge-session in text"}},
			bridgeRecord("cse_alice_100", 1),
			bridgeRecord("cse_alice_200", 2),
		]);

		expect(await readBridgeSession(filePath)).toStrictEqual({
			bridgeSessionId: "cse_alice_200",
			remoteHistory: null,
		});
	});

	it("returns null without a bridge-session record", async () => {
		const filePath = await transcript([{type: "custom-title", customTitle: "Daily"}]);

		expect(await readBridgeSession(filePath)).toStrictEqual({bridgeSessionId: null, remoteHistory: null});
	});

	it("reads bridge-session records carrying keys newer than the schema", async () => {
		const filePath = await transcript([{...bridgeRecord("cse_alice_100", 1), extra: true}]);

		expect(await readBridgeSession(filePath)).toStrictEqual({
			bridgeSessionId: "cse_alice_100",
			remoteHistory: null,
		});
	});

	it("ignores bridge-session records that fail the schema", async () => {
		const filePath = await transcript([{...bridgeRecord("cse_alice_100", 1), lastSequenceNum: "one"}]);

		expect(await readBridgeSession(filePath)).toStrictEqual({bridgeSessionId: null, remoteHistory: null});
	});

	it("returns null for a missing file", async () => {
		expect(await readBridgeSession(join(dir, "missing.jsonl"))).toStrictEqual({
			bridgeSessionId: null,
			remoteHistory: null,
		});
	});

	it("reports unsynced remote history from the latest bridge record's noHistoryBackfill, with the latest suppression cause", async () => {
		const suppressedResult = await readBridgeSession(
			await transcript([
				{
					type: "history-suppression",
					sessionId: SESSION_ID,
					cause: "chokepoint_veto",
					ts: "2026-10-23T00:29:58.293Z",
				},
				{
					type: "history-suppression",
					sessionId: SESSION_ID,
					cause: "migration",
					ts: "2026-10-23T01:10:36.337Z",
				},
				{...bridgeRecord("cse_alice_100", 0), noHistoryBackfill: true},
			]),
		);
		const backfilledResult = await readBridgeSession(
			await transcript([
				{...bridgeRecord("cse_alice_100", 0), noHistoryBackfill: true},
				bridgeRecord("cse_alice_200", 1),
			]),
		);
		const unknownCause = await readBridgeSession(
			await transcript([
				{
					type: "history-suppression",
					sessionId: SESSION_ID,
					cause: "future_cause",
					ts: "2026-10-23T01:10:36.337Z",
				},
				{...bridgeRecord("cse_alice_100", 0), noHistoryBackfill: true},
			]),
		);
		const noCause = await readBridgeSession(
			await transcript([{...bridgeRecord("cse_alice_100", 0), noHistoryBackfill: true}]),
		);
		expect({suppressedResult, backfilledResult, unknownCause, noCause}).toStrictEqual({
			suppressedResult: {bridgeSessionId: "cse_alice_100", remoteHistory: {cause: "migration"}},
			backfilledResult: {bridgeSessionId: "cse_alice_200", remoteHistory: null},
			unknownCause: {bridgeSessionId: "cse_alice_100", remoteHistory: {cause: "future_cause"}},
			noCause: {bridgeSessionId: "cse_alice_100", remoteHistory: {cause: null}},
		});
	});
});

describe("POST /api/open-in-finder", () => {
	const CWD = "/Users/alice/projects/alpha";

	function request(body: unknown, headers?: HeadersInit): Request {
		const requestHeaders = new Headers(headers);
		requestHeaders.set("Content-Type", "application/json");
		return new Request("http://127.0.0.1:7526/api/open-in-finder", {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(body),
		});
	}

	function fakes(cwds: Record<string, string>, directories: readonly string[] = [CWD]) {
		const opened: string[] = [];
		const dependencies: OpenInFinderDependencies = {
			rejectRequest: rejectCrossSite,
			resolveSessionCwd: async (sessionId) => Promise.resolve(cwds[sessionId] ?? null),
			isDirectory: async (path) => Promise.resolve(directories.includes(path)),
			openPath: async (path) => {
				opened.push(path);
				return Promise.resolve();
			},
		};
		return {dependencies, opened};
	}

	async function describeResponse(response: Response) {
		return {status: response.status, body: await response.json()};
	}

	it("opens the session's directory", async () => {
		const {dependencies, opened} = fakes({[SESSION_ID]: CWD});

		const response = await handleOpenInFinder(request({sessionId: SESSION_ID}), dependencies);

		expect(await describeResponse(response)).toEqual({status: 200, body: {ok: true}});
		expect(opened).toEqual([CWD]);
	});

	it("refuses a caller-supplied path", async () => {
		const {dependencies, opened} = fakes({[SESSION_ID]: CWD});

		const response = await handleOpenInFinder(request({sessionId: SESSION_ID, path: "/etc"}), dependencies);

		expect(response.status).toBe(400);
		expect(opened).toEqual([]);
	});

	it("refuses an unknown session", async () => {
		const {dependencies, opened} = fakes({[SESSION_ID]: CWD});

		const response = await handleOpenInFinder(request({sessionId: "../../etc"}), dependencies);

		expect(await describeResponse(response)).toEqual({
			status: 404,
			body: {error: "Unknown session"},
		});
		expect(opened).toEqual([]);
	});

	it("refuses a session directory that no longer exists", async () => {
		const {dependencies, opened} = fakes({[SESSION_ID]: CWD}, []);

		const response = await handleOpenInFinder(request({sessionId: SESSION_ID}), dependencies);

		expect(await describeResponse(response)).toEqual({
			status: 404,
			body: {error: "Session directory not found"},
		});
		expect(opened).toEqual([]);
	});

	it("refuses cross-site requests", async () => {
		const {dependencies, opened} = fakes({[SESSION_ID]: CWD});

		const response = await handleOpenInFinder(
			request({sessionId: SESSION_ID}, {Origin: "https://evil.example"}),
			dependencies,
		);

		expect(response.status).toBe(403);
		expect(opened).toEqual([]);
	});
});

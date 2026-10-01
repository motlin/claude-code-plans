import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {handleOpenInFinder, type OpenInFinderDependencies} from "../src/lib/open-in-finder";
import {getSessionMenuItems, type SessionMenuCapability, type SessionMenuSession} from "../src/lib/session-menu-items";
import {claudeAiSessionUrl, sessionResumeCommand, vscodeFolderUrl} from "../src/lib/session-open-in";
import {readBridgeSessionId} from "../src/lib/sessions";
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
		hasLivePane: false,
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
		expect(openInSubmenu({hasLivePane: true, bridgeSessionId: "cse_alice_100"})).toEqual([
			{kind: "item", id: "open-terminal", label: "Terminal", accelerator: "1"},
			{kind: "item", id: "open-live-terminal", label: "Live terminal", accelerator: "2"},
			{kind: "item", id: "open-vscode", label: "VS Code", accelerator: "3"},
			{kind: "item", id: "open-finder", label: "Finder", accelerator: "4"},
			{kind: "item", id: "open-claude-ai", label: "claude.ai", accelerator: "5"},
		]);
	});

	it("omits the live terminal and claude.ai without a pane or bridge session", () => {
		expect(openInSubmenu({})).toEqual([
			{kind: "item", id: "open-terminal", label: "Terminal", accelerator: "1"},
			{kind: "item", id: "open-vscode", label: "VS Code", accelerator: "2"},
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

	it("links the claude.ai bridge session", () => {
		expect(claudeAiSessionUrl("cse_01UPvLZzECFKuEdEdCRQEhg9")).toBe(
			"https://claude.ai/code/cse_01UPvLZzECFKuEdEdCRQEhg9",
		);
	});
});

describe("readBridgeSessionId", () => {
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

		expect(await readBridgeSessionId(filePath)).toBe("cse_alice_200");
	});

	it("returns null without a bridge-session record", async () => {
		const filePath = await transcript([{type: "custom-title", customTitle: "Daily"}]);

		expect(await readBridgeSessionId(filePath)).toBeNull();
	});

	it("ignores bridge-session records that fail the strict schema", async () => {
		const filePath = await transcript([{...bridgeRecord("cse_alice_100", 1), extra: true}]);

		expect(await readBridgeSessionId(filePath)).toBeNull();
	});

	it("returns null for a missing file", async () => {
		expect(await readBridgeSessionId(join(dir, "missing.jsonl"))).toBeNull();
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
			resolveSessionCwd: async (sessionId) => cwds[sessionId] ?? null,
			isDirectory: async (path) => directories.includes(path),
			openPath: async (path) => {
				opened.push(path);
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

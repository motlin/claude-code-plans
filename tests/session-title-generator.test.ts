import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {
	conversationFromLines,
	generatedTitleSources,
	generateSessionTitle,
	isPaneNameTitle,
	parseGeneratedTitle,
	requestSessionTitle,
	startSessionTitleWorker,
	titleNeedsGeneration,
	TITLE_REGENERATE_MESSAGES,
	type StoredSessionTitle,
} from "../src/lib/session-title-generator";
import {flushWorker, heldModel} from "./held-model";

const testDir = join(tmpdir(), `claude-session-title-test-${process.pid}`);
const PROJECT_ID = "-tmp-test-alice-klass";
const SESSION_ID = "session-test-200";
const CWD = "/tmp/test/alice/klass";
const NOW = 946_598_400_000;
let db: AppDb;

function record(fields: Record<string, unknown>): string {
	return JSON.stringify({sessionId: SESSION_ID, ...fields});
}

const PANE_NAME = record({type: "custom-title", customTitle: "klass"});
const AGENT_NAME = record({type: "agent-name", agentName: "klass"});
const PROMPT = record({type: "user", uuid: "u-1", message: {role: "user", content: "Review pull request 910"}});
const TOOL_RESULT = record({
	type: "user",
	uuid: "u-2",
	message: {role: "user", content: [{type: "tool_result", tool_use_id: "t-1", content: "diff output"}]},
});
const SIDECHAIN = record({
	type: "assistant",
	uuid: "s-1",
	isSidechain: true,
	message: {role: "assistant", content: [{type: "text", text: "subagent text"}]},
});
const REPLY = record({
	type: "assistant",
	uuid: "a-1",
	message: {role: "assistant", content: [{type: "text", text: "The pull request looks good."}]},
});

function writeTranscript(lines: readonly string[]): string {
	const dir = join(testDir, PROJECT_ID);
	mkdirSync(dir, {recursive: true});
	const filePath = join(dir, `${SESSION_ID}.jsonl`);
	writeFileSync(filePath, `${lines.join("\n")}\n`);
	return filePath;
}

function stubModel(answer: string): {prompts: string[]; run: (prompt: string) => Promise<string>} {
	const prompts: string[] = [];
	return {
		prompts,
		run: async (prompt) => {
			prompts.push(prompt);
			return Promise.resolve(answer);
		},
	};
}

function storedRows(): unknown[] {
	return db.summaries
		.select({
			sessionId: schema.generatedTitles.sessionId,
			customTitle: schema.generatedTitles.customTitle,
			paneNamed: schema.generatedTitles.paneNamed,
			agentName: schema.generatedTitles.agentName,
			cwdBasename: schema.generatedTitles.cwdBasename,
			title: schema.generatedTitles.title,
			messageCount: schema.generatedTitles.messageCount,
		})
		.from(schema.generatedTitles)
		.all();
}

beforeEach(() => {
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe("isPaneNameTitle", () => {
	it("matches a custom title equal to the agent name or the cwd basename", () => {
		expect([
			isPaneNameTitle("klass", {cwdBasename: "klass"}),
			isPaneNameTitle("do-all", {agentName: "do-all", cwdBasename: "workflowy"}),
			isPaneNameTitle("Release checklist", {agentName: "klass", cwdBasename: "klass"}),
			isPaneNameTitle(undefined, {agentName: "klass", cwdBasename: "klass"}),
		]).toStrictEqual([true, true, false, false]);
	});
});

describe("titleNeedsGeneration", () => {
	const stored: StoredSessionTitle = {
		customTitle: "klass",
		paneNamed: true,
		agentName: "klass",
		cwdBasename: "klass",
		title: "Klass pull request 910",
		messageCount: 40,
	};

	it("generates once, then again after the conversation moves on or the custom title changes", () => {
		expect({
			never: titleNeedsGeneration(undefined, {customTitle: "klass", messageCount: 40}),
			unchanged: titleNeedsGeneration(stored, {customTitle: "klass", messageCount: 40}),
			fewNew: titleNeedsGeneration(stored, {
				customTitle: "klass",
				messageCount: 40 + TITLE_REGENERATE_MESSAGES - 1,
			}),
			movedOn: titleNeedsGeneration(stored, {customTitle: "klass", messageCount: 40 + TITLE_REGENERATE_MESSAGES}),
			renamed: titleNeedsGeneration(stored, {customTitle: "Release checklist", messageCount: 40}),
			deliberate: titleNeedsGeneration(
				{...stored, customTitle: "Release checklist", paneNamed: false, title: null},
				{customTitle: "Release checklist", messageCount: 400},
			),
		}).toStrictEqual({
			never: true,
			unchanged: false,
			fewNew: false,
			movedOn: true,
			renamed: true,
			deliberate: false,
		});
	});
});

describe("conversationFromLines", () => {
	it("keeps the main thread's typed prompts and assistant text", () => {
		expect(conversationFromLines([PANE_NAME, PROMPT, TOOL_RESULT, SIDECHAIN, REPLY])).toStrictEqual({
			agentName: null,
			conversation: "[user]\nReview pull request 910\n\n[assistant]\nThe pull request looks good.",
		});
	});

	it("reads the latest agent name", () => {
		expect(conversationFromLines([AGENT_NAME, PROMPT]).agentName).toBe("klass");
	});
});

describe("parseGeneratedTitle", () => {
	it("takes the first line without quotes or a trailing period and rejects empty or long output", () => {
		expect([
			parseGeneratedTitle("Klass pull request 910\n"),
			parseGeneratedTitle('"Klass pull request 910."'),
			parseGeneratedTitle("Title: Klass pull request 910"),
			parseGeneratedTitle("  \n"),
			parseGeneratedTitle("x".repeat(81)),
		]).toStrictEqual(["Klass pull request 910", "Klass pull request 910", "Klass pull request 910", null, null]);
	});
});

describe("generateSessionTitle", () => {
	it("titles a pane-named session from its recent conversation and stores the title", async () => {
		const filePath = writeTranscript([PANE_NAME, AGENT_NAME, PROMPT, REPLY]);
		const model = stubModel("Klass pull request 910");

		const stored = await generateSessionTitle(
			db.summaries,
			{sessionId: SESSION_ID, filePath, customTitle: "klass", cwd: CWD, messageCount: 2},
			model.run,
		);

		const row = {
			customTitle: "klass",
			paneNamed: true,
			agentName: "klass",
			cwdBasename: "klass",
			title: "Klass pull request 910",
			messageCount: 2,
		};
		expect({
			stored,
			asked: model.prompts.map((prompt) => prompt.includes("[user]\nReview pull request 910")),
			rows: storedRows(),
		}).toStrictEqual({
			stored: row,
			asked: [true],
			rows: [{sessionId: SESSION_ID, ...row, paneNamed: 1}],
		});
	});

	it("never asks the model about a deliberately renamed session", async () => {
		const filePath = writeTranscript([AGENT_NAME, PROMPT, REPLY]);
		const model = stubModel("Klass pull request 910");

		const stored = await generateSessionTitle(
			db.summaries,
			{sessionId: SESSION_ID, filePath, customTitle: "Release checklist", cwd: CWD, messageCount: 2},
			model.run,
		);

		expect({stored, prompts: model.prompts.length}).toStrictEqual({
			stored: {
				customTitle: "Release checklist",
				paneNamed: false,
				agentName: "klass",
				cwdBasename: "klass",
				title: null,
				messageCount: 2,
			},
			prompts: 0,
		});
	});

	it("keeps the previous title when the model gives no usable title", async () => {
		const filePath = writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const request = {sessionId: SESSION_ID, filePath, customTitle: "klass", cwd: CWD, messageCount: 2};
		await generateSessionTitle(db.summaries, request, stubModel("Klass pull request 910").run);

		const stored = await generateSessionTitle(db.summaries, {...request, messageCount: 30}, stubModel("").run);

		expect(stored).toStrictEqual({
			customTitle: "klass",
			paneNamed: true,
			agentName: null,
			cwdBasename: "klass",
			title: "Klass pull request 910",
			messageCount: 30,
		});
	});
});

describe("session title worker", () => {
	it("titles a requested session, reports it, and serves the title only for that custom title", async () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const reported: string[] = [];
		let resolve = () => {};
		const titled = new Promise<undefined>((done) => {
			resolve = () => {
				done(undefined);
			};
		});
		const stop = startSessionTitleWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: stubModel("Klass pull request 910").run,
			onTitle: (sessionId) => {
				reported.push(sessionId);
				resolve();
			},
		});
		try {
			const request = {
				sessionId: SESSION_ID,
				project: PROJECT_ID,
				customTitle: "klass",
				cwd: CWD,
				messageCount: 2,
				mtimeMs: NOW,
			};
			const before = generatedTitleSources(SESSION_ID, "klass");
			requestSessionTitle(request, NOW);
			await titled;

			expect({
				before,
				reported,
				sources: generatedTitleSources(SESSION_ID, "klass"),
				renamed: generatedTitleSources(SESSION_ID, "Release checklist"),
			}).toStrictEqual({
				before: {},
				reported: [SESSION_ID],
				sources: {generatedTitle: "Klass pull request 910", cwdBasename: "klass"},
				renamed: {},
			});
		} finally {
			stop();
		}
	});

	it("writes, reports, and logs nothing when the model answers after the worker stops", async () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const model = heldModel();
		const reported: string[] = [];
		const stop = startSessionTitleWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: model.run,
			onTitle: (sessionId) => {
				reported.push(sessionId);
			},
		});
		requestSessionTitle(
			{sessionId: SESSION_ID, project: PROJECT_ID, customTitle: "klass", cwd: CWD, messageCount: 2, mtimeMs: NOW},
			NOW,
		);
		await model.asked;
		stop();
		model.release("Klass pull request 910");
		await flushWorker();

		expect({
			rows: storedRows(),
			reported,
			errors: consoleError.mock.calls,
			sources: generatedTitleSources(SESSION_ID, "klass"),
		}).toStrictEqual({rows: [], reported: [], errors: [], sources: {}});
		consoleError.mockRestore();
	});

	it("logs nothing when the model answers after shutdown closed the database", async () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const model = heldModel();
		const stop = startSessionTitleWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: model.run,
			onTitle: () => {},
		});
		requestSessionTitle(
			{sessionId: SESSION_ID, project: PROJECT_ID, customTitle: "klass", cwd: CWD, messageCount: 2, mtimeMs: NOW},
			NOW,
		);
		await model.asked;
		stop();
		db.close();
		model.release("Klass pull request 910");
		await flushWorker();

		expect(consoleError.mock.calls).toStrictEqual([]);
		consoleError.mockRestore();
	});

	it("ignores requests until the worker starts", () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		requestSessionTitle(
			{sessionId: SESSION_ID, project: PROJECT_ID, customTitle: "klass", cwd: CWD, messageCount: 2, mtimeMs: NOW},
			NOW,
		);

		expect(generatedTitleSources(SESSION_ID, "klass")).toStrictEqual({});
	});
});

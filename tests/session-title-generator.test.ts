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
	TITLE_RETRY_MS,
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
			never: titleNeedsGeneration(undefined, {customTitle: "klass", messageCount: 40}, NOW),
			unchanged: titleNeedsGeneration(stored, {customTitle: "klass", messageCount: 40}, NOW),
			fewNew: titleNeedsGeneration(
				stored,
				{customTitle: "klass", messageCount: 40 + TITLE_REGENERATE_MESSAGES - 1},
				NOW,
			),
			movedOn: titleNeedsGeneration(
				stored,
				{customTitle: "klass", messageCount: 40 + TITLE_REGENERATE_MESSAGES},
				NOW,
			),
			renamed: titleNeedsGeneration(stored, {customTitle: "Release checklist", messageCount: 40}, NOW),
			deliberate: titleNeedsGeneration(
				{...stored, customTitle: "Release checklist", paneNamed: false, title: null},
				{customTitle: "Release checklist", messageCount: 400},
				NOW,
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

	it("retries an untitled pane-named session, but not before a failed attempt's backoff ends", () => {
		const untitled = {...stored, title: null};
		const failed = {...untitled, retryAt: NOW + TITLE_RETRY_MS};
		const current = {customTitle: "klass", messageCount: 40};
		expect({
			untitled: titleNeedsGeneration(untitled, current, NOW),
			backingOff: titleNeedsGeneration(failed, current, NOW + TITLE_RETRY_MS - 1),
			backedOff: titleNeedsGeneration(failed, current, NOW + TITLE_RETRY_MS),
			titledBackingOff: titleNeedsGeneration(
				{...stored, retryAt: NOW + TITLE_RETRY_MS},
				{customTitle: "klass", messageCount: 40 + TITLE_REGENERATE_MESSAGES},
				NOW,
			),
		}).toStrictEqual({untitled: true, backingOff: false, backedOff: true, titledBackingOff: false});
	});
});

describe("conversationFromLines", () => {
	it("keeps the main thread's typed prompts and assistant text", () => {
		expect(conversationFromLines([PANE_NAME, PROMPT, TOOL_RESULT, SIDECHAIN, REPLY])).toStrictEqual({
			agentName: null,
			conversation: "[user]\nReview pull request 910\n\n[assistant]\nThe pull request looks good.",
		});
	});

	it("falls back to the last typed prompt when the tail holds no prompt or assistant text", () => {
		const lastPrompt = record({type: "last-prompt", lastPrompt: "Collapse the migrations"});
		expect([
			conversationFromLines([PANE_NAME, lastPrompt, TOOL_RESULT]).conversation,
			conversationFromLines([lastPrompt, PROMPT]).conversation,
		]).toStrictEqual(["[user]\nCollapse the migrations", "[user]\nReview pull request 910"]);
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
			parseGeneratedTitle('""'),
			parseGeneratedTitle("x".repeat(81)),
		]).toStrictEqual([
			"Klass pull request 910",
			"Klass pull request 910",
			"Klass pull request 910",
			null,
			null,
			null,
		]);
	});

	it("skips a lead-in line that ends with a colon", () => {
		expect([
			parseGeneratedTitle("Caveman title, sentence case, 3-6 words:\nKlass pull request 910"),
			parseGeneratedTitle("Title:"),
		]).toStrictEqual(["Klass pull request 910", null]);
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

	it("fails and stores nothing when the model gives no usable title, keeping the previous title", async () => {
		const filePath = writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const request = {sessionId: SESSION_ID, filePath, customTitle: "klass", cwd: CWD, messageCount: 2};
		await generateSessionTitle(db.summaries, request, stubModel("Klass pull request 910").run);

		const failure = await generateSessionTitle(
			db.summaries,
			{...request, messageCount: 30},
			stubModel("").run,
		).then(
			() => null,
			(err: unknown) => String(err),
		);

		expect({failure, rows: storedRows()}).toStrictEqual({
			failure: 'Error: The model gave no usable title: ""',
			rows: [
				{
					sessionId: SESSION_ID,
					customTitle: "klass",
					paneNamed: 1,
					agentName: null,
					cwdBasename: "klass",
					title: "Klass pull request 910",
					messageCount: 2,
				},
			],
		});
	});

	it("fails without asking the model when there is no conversation to title", async () => {
		const filePath = writeTranscript([PANE_NAME, TOOL_RESULT]);
		const model = stubModel("Klass pull request 910");

		const failure = await generateSessionTitle(
			db.summaries,
			{sessionId: SESSION_ID, filePath, customTitle: "klass", cwd: CWD, messageCount: 2},
			model.run,
		).then(
			() => null,
			(err: unknown) => String(err),
		);

		expect({failure, prompts: model.prompts.length, rows: storedRows()}).toStrictEqual({
			failure: "Error: No conversation to title",
			prompts: 0,
			rows: [],
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

	it("retries a failed title once the backoff ends, not on every request", async () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const answers = ["", "Klass pull request 910"];
		let asked = 0;
		const stop = startSessionTitleWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: async () => {
				asked++;
				return Promise.resolve(answers.shift() ?? "");
			},
			onTitle: () => {},
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
			requestSessionTitle(request, NOW);
			await vi.waitFor(() => {
				expect(consoleError).toHaveBeenCalledOnce();
			});
			requestSessionTitle(request, NOW + TITLE_RETRY_MS - 1);
			const afterFailure = {asked, sources: generatedTitleSources(SESSION_ID, "klass"), rows: storedRows()};
			requestSessionTitle(request, NOW + TITLE_RETRY_MS);
			await vi.waitFor(() => {
				expect(generatedTitleSources(SESSION_ID, "klass")).not.toStrictEqual({});
			});

			expect({
				afterFailure,
				asked,
				sources: generatedTitleSources(SESSION_ID, "klass"),
				errors: consoleError.mock.calls.length,
			}).toStrictEqual({
				afterFailure: {asked: 1, sources: {}, rows: []},
				asked: 2,
				sources: {generatedTitle: "Klass pull request 910", cwdBasename: "klass"},
				errors: 1,
			});
		} finally {
			stop();
			consoleError.mockRestore();
		}
	});

	it("retries a stored row that has no title and never serves an empty one", async () => {
		writeTranscript([PANE_NAME, PROMPT, REPLY]);
		const row = {customTitle: "klass", paneNamed: 1, agentName: null, cwdBasename: "klass", messageCount: 2};
		db.summaries
			.insert(schema.generatedTitles)
			.values({sessionId: SESSION_ID, ...row, title: "", generatedAt: NOW})
			.run();
		const model = stubModel("Klass pull request 910");
		const stop = startSessionTitleWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: model.run,
			onTitle: () => {},
		});
		try {
			const before = generatedTitleSources(SESSION_ID, "klass");
			requestSessionTitle(
				{
					sessionId: SESSION_ID,
					project: PROJECT_ID,
					customTitle: "klass",
					cwd: CWD,
					messageCount: 2,
					mtimeMs: NOW,
				},
				NOW,
			);
			await vi.waitFor(() => {
				expect(generatedTitleSources(SESSION_ID, "klass")).not.toStrictEqual({});
			});

			expect({
				before,
				prompts: model.prompts.length,
				sources: generatedTitleSources(SESSION_ID, "klass"),
			}).toStrictEqual({
				before: {},
				prompts: 1,
				sources: {generatedTitle: "Klass pull request 910", cwdBasename: "klass"},
			});
		} finally {
			stop();
		}
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

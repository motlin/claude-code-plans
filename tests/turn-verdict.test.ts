import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {
	finalTurnFromLines,
	generateTurnVerdict,
	parseTurnVerdict,
	requestTurnVerdict,
	startTurnVerdictWorker,
	turnVerdictNeedsInput,
} from "../src/lib/turn-verdict";
import {flushWorker, heldModel} from "./held-model";

const testDir = join(tmpdir(), `claude-turn-verdict-test-${process.pid}`);
const PROJECT_ID = "-tmp-test-alice-project";
const SESSION_ID = "session-test-100";
const NOW = 946_598_400_000;
let db: AppDb;

function record(fields: Record<string, unknown>): string {
	return JSON.stringify({sessionId: SESSION_ID, ...fields});
}

const PROMPT = record({type: "user", uuid: "u-1", message: {role: "user", content: "Fix the test login bug"}});
const TOOL_CALL = record({
	type: "assistant",
	uuid: "a-1",
	message: {
		role: "assistant",
		content: [
			{type: "text", text: "Looking."},
			{type: "tool_use", id: "t-1", name: "Bash"},
		],
	},
});
const TOOL_RESULT = record({
	type: "user",
	uuid: "u-2",
	message: {role: "user", content: [{type: "tool_result", tool_use_id: "t-1", content: "ok"}]},
});
const SIDECHAIN = record({
	type: "assistant",
	uuid: "s-1",
	isSidechain: true,
	message: {role: "assistant", content: [{type: "text", text: "subagent text"}]},
});
const ASK = record({
	type: "assistant",
	uuid: "a-2",
	message: {role: "assistant", content: [{type: "text", text: "Fixed. Your call: push it?"}]},
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

beforeEach(() => {
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe("finalTurnFromLines", () => {
	it("keeps the main-thread assistant text since the last typed prompt", () => {
		expect(finalTurnFromLines([PROMPT, TOOL_CALL, TOOL_RESULT, SIDECHAIN, ASK])).toStrictEqual({
			uuid: "a-2",
			text: "Looking.\n\nFixed. Your call: push it?",
		});
	});

	it("has no final turn once a new prompt has no reply yet", () => {
		expect(finalTurnFromLines([PROMPT, ASK, PROMPT])).toBeNull();
	});
});

describe("parseTurnVerdict", () => {
	it("reads either word and rejects anything else", () => {
		expect([
			parseTurnVerdict("NEEDS_INPUT"),
			parseTurnVerdict(" NO_INPUT\n"),
			parseTurnVerdict("maybe"),
		]).toStrictEqual([true, false, null]);
	});
});

describe("generateTurnVerdict", () => {
	it("asks the model about the final turn and stores its verdict for the turn end", async () => {
		const filePath = writeTranscript([PROMPT, ASK]);
		const model = stubModel("NEEDS_INPUT");

		const verdict = await generateTurnVerdict(
			db.summaries,
			{sessionId: SESSION_ID, filePath, turnEndedAt: NOW},
			model.run,
		);

		expect({
			verdict,
			asked: model.prompts.map((prompt) => prompt.includes("<message>\nFixed. Your call: push it?\n</message>")),
			rows: db.summaries
				.select({
					sessionId: schema.turnVerdicts.sessionId,
					turnUuid: schema.turnVerdicts.turnUuid,
					turnEndedAt: schema.turnVerdicts.turnEndedAt,
					needsInput: schema.turnVerdicts.needsInput,
				})
				.from(schema.turnVerdicts)
				.all(),
		}).toStrictEqual({
			verdict: {turnEndedAt: NOW, needsInput: true},
			asked: [true],
			rows: [{sessionId: SESSION_ID, turnUuid: "a-2", turnEndedAt: NOW, needsInput: 1}],
		});
	});

	it("restamps a stored verdict without the model when the final turn is unchanged", async () => {
		const filePath = writeTranscript([PROMPT, ASK]);
		await generateTurnVerdict(
			db.summaries,
			{sessionId: SESSION_ID, filePath, turnEndedAt: NOW},
			stubModel("NO_INPUT").run,
		);
		const again = stubModel("NEEDS_INPUT");

		const verdict = await generateTurnVerdict(
			db.summaries,
			{sessionId: SESSION_ID, filePath, turnEndedAt: NOW + 1000},
			again.run,
		);

		expect({verdict, prompts: again.prompts.length}).toStrictEqual({
			verdict: {turnEndedAt: NOW + 1000, needsInput: false},
			prompts: 0,
		});
	});

	it("stores nothing when the model gives neither word", async () => {
		const filePath = writeTranscript([PROMPT, ASK]);

		const verdict = await generateTurnVerdict(
			db.summaries,
			{sessionId: SESSION_ID, filePath, turnEndedAt: NOW},
			stubModel("I am not sure").run,
		);

		expect({verdict, rows: db.summaries.select().from(schema.turnVerdicts).all()}).toStrictEqual({
			verdict: null,
			rows: [],
		});
	});
});

describe("turn verdict worker", () => {
	it("judges a requested turn, reports a waiting session, and answers only for that turn end", async () => {
		writeTranscript([PROMPT, ASK]);
		const reported: string[] = [];
		let resolve = () => {};
		const verdictReported = new Promise<undefined>((done) => {
			resolve = () => {
				done(undefined);
			};
		});
		const stop = startTurnVerdictWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: stubModel("NEEDS_INPUT").run,
			onVerdict: (sessionId) => {
				reported.push(sessionId);
				resolve();
			},
		});
		try {
			const before = turnVerdictNeedsInput(SESSION_ID, NOW);
			requestTurnVerdict(SESSION_ID, PROJECT_ID, NOW, NOW);
			await verdictReported;

			expect({
				before,
				reported,
				sameTurn: turnVerdictNeedsInput(SESSION_ID, NOW),
				laterTurn: turnVerdictNeedsInput(SESSION_ID, NOW + 1000),
			}).toStrictEqual({before: false, reported: [SESSION_ID], sameTurn: true, laterTurn: false});
		} finally {
			stop();
		}
	});

	it("writes, reports, and logs nothing when the model answers after the worker stops", async () => {
		writeTranscript([PROMPT, ASK]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const model = heldModel();
		const reported: string[] = [];
		const stop = startTurnVerdictWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: model.run,
			onVerdict: (sessionId) => {
				reported.push(sessionId);
			},
		});
		requestTurnVerdict(SESSION_ID, PROJECT_ID, NOW, NOW);
		await model.asked;
		stop();
		model.release("NEEDS_INPUT");
		await flushWorker();

		expect({
			rows: db.summaries.select().from(schema.turnVerdicts).all(),
			reported,
			errors: consoleError.mock.calls,
			needsInput: turnVerdictNeedsInput(SESSION_ID, NOW),
		}).toStrictEqual({rows: [], reported: [], errors: [], needsInput: false});
		consoleError.mockRestore();
	});

	it("logs nothing when the model answers after shutdown closed the database", async () => {
		writeTranscript([PROMPT, ASK]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const model = heldModel();
		const stop = startTurnVerdictWorker({
			summariesDb: db.summaries,
			projectsDir: testDir,
			runModel: model.run,
			onVerdict: () => {},
		});
		requestTurnVerdict(SESSION_ID, PROJECT_ID, NOW, NOW);
		await model.asked;
		stop();
		db.close();
		model.release("NEEDS_INPUT");
		await flushWorker();

		expect(consoleError.mock.calls).toStrictEqual([]);
		consoleError.mockRestore();
	});

	it("ignores requests until the worker starts", () => {
		writeTranscript([PROMPT, ASK]);
		requestTurnVerdict(SESSION_ID, PROJECT_ID, NOW, NOW);

		expect(turnVerdictNeedsInput(SESSION_ID, NOW)).toBe(false);
	});
});

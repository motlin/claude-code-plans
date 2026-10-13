import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	clearAllPendingQuestions,
	clearPendingQuestion,
	getPendingQuestion,
	persistPendingQuestionsTo,
	setPendingQuestion,
} from "../src/lib/pending-question-store";
import {clearSessionRegistry, refreshSessionRegistry} from "../src/lib/session-registry-store";
import {handlePendingQuestionRequest} from "../src/routes/api/sessions.$id.pending-question";

const PENDING = {
	toolUseId: "toolu_alice",
	questions: [
		{
			question: "Go with option 4, or keep the timeout and use option 2?",
			options: [{label: "Option 4 (Recommended)", description: "Drop query_timeout."}, {label: "Option 2"}],
		},
	],
};

let testDir: string;
let file: string;

beforeEach(() => {
	testDir = mkdtempSync(join(tmpdir(), "pending-questions-"));
	file = join(testDir, "pending-questions.json");
});

afterEach(() => {
	clearAllPendingQuestions();
	clearSessionRegistry();
	rmSync(testDir, {recursive: true, force: true});
});

/** A server restart: the in-memory store is gone, then startup reloads the file. */
function restart(): void {
	clearAllPendingQuestions();
	persistPendingQuestionsTo(file);
}

async function registerProcess(status: "idle" | "waiting"): Promise<void> {
	const dir = join(testDir, "sessions");
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, "4242.json"),
		JSON.stringify({
			pid: 4242,
			sessionId: "session-alice",
			cwd: "/tmp/alice",
			startedAt: 946_598_400_000,
			procStart: "Fri Dec 31 00:00:00 1999",
			version: "2.0.0",
			kind: "interactive",
			entrypoint: "cli",
			pidDomain: "darwin",
			status,
			...(status === "waiting" ? {waitingFor: "input needed"} : {}),
			updatedAt: 946_598_402_000,
			statusUpdatedAt: 946_598_402_000,
		}),
	);
	await refreshSessionRegistry(dir, {isAlive: () => true, readStartTimes: async () => Promise.resolve(null)});
}

describe("pending-question persistence", () => {
	it("survives a restart, and a cleared question stays cleared", () => {
		persistPendingQuestionsTo(file);
		setPendingQuestion("session-alice", PENDING);
		setPendingQuestion("session-bob", {...PENDING, toolUseId: "toolu_bob"});
		restart();
		const reloaded = getPendingQuestion("session-alice");
		clearPendingQuestion("session-bob");
		restart();

		expect({
			reloaded,
			bob: getPendingQuestion("session-bob"),
			onDisk: Object.keys(JSON.parse(readFileSync(file, "utf8")) as object),
		}).toStrictEqual({reloaded: PENDING, bob: null, onDisk: ["session-alice"]});
	});

	it("starts empty from a missing or unreadable file", () => {
		persistPendingQuestionsTo(file);
		const missing = getPendingQuestion("session-alice");
		writeFileSync(file, "{not json");
		restart();

		expect([missing, getPendingQuestion("session-alice")]).toStrictEqual([null, null]);
	});

	it("serves a reloaded question while the session still waits, and drops it once the session moved on", async () => {
		persistPendingQuestionsTo(file);
		setPendingQuestion("session-alice", PENDING);
		restart();
		await registerProcess("waiting");
		const waiting = (await handlePendingQuestionRequest("session-alice").json()) as unknown;
		await registerProcess("idle");
		const idle = (await handlePendingQuestionRequest("session-alice").json()) as unknown;
		restart();

		expect({waiting, idle, afterRestart: getPendingQuestion("session-alice")}).toStrictEqual({
			waiting: {pendingQuestion: PENDING},
			idle: {pendingQuestion: null},
			afterRestart: null,
		});
	});
});

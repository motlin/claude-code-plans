import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	clearAllPendingPlans,
	clearPendingPlan,
	getPendingPlan,
	persistPendingPlansTo,
	setPendingPlan,
} from "../src/lib/pending-plan-store";
import {clearSessionRegistry, refreshSessionRegistry} from "../src/lib/session-registry-store";
import {handlePendingPlanRequest} from "../src/routes/api/sessions.$id.pending-plan";

const PENDING = {
	toolUseId: "toolu_alice",
	plan: "# Say hello\n\n1. Print hello",
	planFilePath: "/tmp/plans/say-hello.md",
};

let testDir: string;
let file: string;

beforeEach(() => {
	testDir = mkdtempSync(join(tmpdir(), "pending-plans-"));
	file = join(testDir, "pending-plans.json");
});

afterEach(() => {
	clearAllPendingPlans();
	clearSessionRegistry();
	rmSync(testDir, {recursive: true, force: true});
});

/** A server restart: the in-memory store is gone, then startup reloads the file. */
function restart(): void {
	clearAllPendingPlans();
	persistPendingPlansTo(file);
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

describe("pending-plan persistence", () => {
	it("survives a restart, and a cleared plan stays cleared", () => {
		persistPendingPlansTo(file);
		setPendingPlan("session-alice", PENDING);
		setPendingPlan("session-bob", {toolUseId: "", plan: "Bob's plan"});
		restart();
		const reloaded = getPendingPlan("session-alice");
		clearPendingPlan("session-bob");
		restart();

		expect({
			reloaded,
			bob: getPendingPlan("session-bob"),
			onDisk: Object.keys(JSON.parse(readFileSync(file, "utf8")) as object),
		}).toStrictEqual({reloaded: PENDING, bob: null, onDisk: ["session-alice"]});
	});

	it("starts empty from a missing or unreadable file", () => {
		persistPendingPlansTo(file);
		const missing = getPendingPlan("session-alice");
		writeFileSync(file, "{not json");
		restart();

		expect([missing, getPendingPlan("session-alice")]).toStrictEqual([null, null]);
	});

	it("serves a reloaded plan while the session still waits, and drops it once the session moved on", async () => {
		persistPendingPlansTo(file);
		setPendingPlan("session-alice", PENDING);
		restart();
		await registerProcess("waiting");
		const waiting = (await handlePendingPlanRequest("session-alice").json()) as unknown;
		await registerProcess("idle");
		const idle = (await handlePendingPlanRequest("session-alice").json()) as unknown;
		restart();

		expect({waiting, idle, afterRestart: getPendingPlan("session-alice")}).toStrictEqual({
			waiting: {pendingPlan: PENDING},
			idle: {pendingPlan: null},
			afterRestart: null,
		});
	});
});

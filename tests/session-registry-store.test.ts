import {describe, expect, it, beforeEach, afterEach, vi} from "vite-plus/test";
import {mkdtempSync, rmSync, unlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SessionRegistryEntry} from "../src/lib/session-registry";
import {
	clearSessionRegistry,
	getRegistrySessionState,
	getRegistrySessionStates,
	pollSessionRegistryLiveness,
	refreshSessionRegistry,
} from "../src/lib/session-registry-store";

function registryFixture(overrides: Partial<SessionRegistryEntry> = {}): SessionRegistryEntry {
	return {
		pid: 4242,
		sessionId: "session-test-100",
		cwd: "/tmp/test/alice-project",
		startedAt: 946_598_400_000,
		procStart: "Fri Dec 31 00:00:00 1999",
		version: "2.0.0",
		kind: "interactive",
		entrypoint: "cli",
		pidDomain: "darwin",
		status: "idle",
		updatedAt: 946_598_401_000,
		statusUpdatedAt: 946_598_401_000,
		...overrides,
	};
}

const everyoneAlive = {isAlive: () => true, readStartTimes: async () => null};

describe("session registry store", () => {
	let dir: string;

	function write(entry: SessionRegistryEntry): void {
		writeFileSync(join(dir, `${entry.pid}.json`), JSON.stringify(entry));
	}

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "session-registry-store-test-"));
		clearSessionRegistry();
	});

	afterEach(() => {
		clearSessionRegistry();
		rmSync(dir, {recursive: true, force: true});
	});

	it("loads live entries by session id and reports which sessions changed", async () => {
		write(registryFixture({status: "waiting", waitingFor: "input needed", statusUpdatedAt: 946_598_402_000}));
		write(registryFixture({pid: 4343, sessionId: "session-test-200", status: "busy"}));

		const changed = await refreshSessionRegistry(dir, everyoneAlive);

		expect({changed: [...changed].sort(), states: getRegistrySessionStates()}).toStrictEqual({
			changed: ["session-test-100", "session-test-200"],
			states: [
				{
					sessionId: "session-test-100",
					pid: 4242,
					cwd: "/tmp/test/alice-project",
					startedAt: 946_598_400_000,
					status: "waiting",
					waitingFor: "input needed",
					statusUpdatedAt: 946_598_402_000,
				},
				{
					sessionId: "session-test-200",
					pid: 4343,
					cwd: "/tmp/test/alice-project",
					startedAt: 946_598_400_000,
					status: "busy",
					statusUpdatedAt: 946_598_401_000,
				},
			],
		});
	});

	it("reports only sessions whose status changed, and removals", async () => {
		write(registryFixture({status: "waiting"}));
		write(registryFixture({pid: 4343, sessionId: "session-test-200", status: "busy"}));
		await refreshSessionRegistry(dir, everyoneAlive);

		write(registryFixture({status: "busy", statusUpdatedAt: 946_598_403_000}));
		unlinkSync(join(dir, "4343.json"));
		const changed = await refreshSessionRegistry(dir, everyoneAlive);
		const unchanged = await refreshSessionRegistry(dir, everyoneAlive);

		expect({changed: [...changed].sort(), unchanged: [...unchanged]}).toStrictEqual({
			changed: ["session-test-100", "session-test-200"],
			unchanged: [],
		});
		expect(getRegistrySessionState("session-test-200")).toBeNull();
	});

	it("keeps the freshest status when two processes run the same session", async () => {
		write(registryFixture({status: "idle", statusUpdatedAt: 946_598_405_000}));
		write(registryFixture({pid: 4343, status: "busy", statusUpdatedAt: 946_598_401_000}));

		await refreshSessionRegistry(dir, everyoneAlive);

		expect(getRegistrySessionState("session-test-100")).toStrictEqual({
			sessionId: "session-test-100",
			pid: 4242,
			cwd: "/tmp/test/alice-project",
			startedAt: 946_598_400_000,
			status: "idle",
			statusUpdatedAt: 946_598_405_000,
		});
	});

	it("drops a session once its pid dies, probing only the registered pids", async () => {
		write(registryFixture({status: "waiting"}));
		await refreshSessionRegistry(dir, everyoneAlive);
		const isAlive = vi.fn(() => false);

		const changed = await pollSessionRegistryLiveness(dir, {isAlive, readStartTimes: async () => null});

		expect({
			changed: [...changed],
			probed: isAlive.mock.calls,
			state: getRegistrySessionState("session-test-100"),
		}).toStrictEqual({
			changed: ["session-test-100"],
			probed: [[4242], [4242]],
			state: null,
		});
	});

	it("leaves the registry alone when every pid still answers", async () => {
		write(registryFixture({status: "busy"}));
		await refreshSessionRegistry(dir, everyoneAlive);
		const readStartTimes = vi.fn(async () => null);

		const changed = await pollSessionRegistryLiveness(dir, {isAlive: () => true, readStartTimes});

		expect({changed: [...changed], psCalls: readStartTimes.mock.calls.length}).toStrictEqual({
			changed: [],
			psCalls: 0,
		});
	});
});

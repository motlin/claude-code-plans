import {describe, expect, it, beforeEach, afterEach} from "vite-plus/test";
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SessionRegistryFileSchema} from "../src/lib/schemas";
import {
	isPidAlive,
	isRegistryFileName,
	liveRegistryEntries,
	parsePsStartTimes,
	readSessionRegistry,
	type SessionRegistryEntry,
} from "../src/lib/session-registry";

function registryFixture(overrides: Partial<SessionRegistryEntry> = {}): SessionRegistryEntry {
	return {
		pid: 4242,
		sessionId: "11111111-2222-3333-4444-555555555555",
		cwd: "/tmp/test/alice-project",
		startedAt: 946_598_400_000,
		procStart: "Fri Dec 31 00:00:00 1999",
		version: "2.0.0",
		peerProtocol: 1,
		peerFeatures: ["notify_idle"],
		kind: "interactive",
		entrypoint: "cli",
		pidDomain: "darwin",
		messagingSocketPath: "/tmp/test/alice.sock",
		name: "test-session",
		nameSource: "derived",
		nameSince: 946_598_400_000,
		status: "idle",
		updatedAt: 946_598_401_000,
		statusUpdatedAt: 946_598_401_000,
		bridgeSessionId: "session_test0001",
		...overrides,
	};
}

describe("SessionRegistryFileSchema", () => {
	it("accepts a full registry file, with and without waitingFor", () => {
		const waiting = registryFixture({status: "waiting", waitingFor: "input needed"});

		expect(SessionRegistryFileSchema.parse(registryFixture())).toStrictEqual(registryFixture());
		expect(SessionRegistryFileSchema.parse(waiting)).toStrictEqual(waiting);
	});

	it("accepts the shell status a session reports while the user runs a ! command", () => {
		// Real shape (2026-10-11), sanitized: a shell session drops waitingFor.
		const shell = registryFixture({status: "shell"});

		expect(SessionRegistryFileSchema.parse(shell)).toStrictEqual(shell);
	});

	it("rejects unknown keys and unknown statuses", () => {
		expect(SessionRegistryFileSchema.safeParse({...registryFixture(), surprise: true}).success).toBe(false);
		expect(SessionRegistryFileSchema.safeParse({...registryFixture(), status: "sleeping"}).success).toBe(false);
	});
});

describe("isRegistryFileName", () => {
	it("matches only <pid>.json, never the <pid>.<hash>.key secrets", () => {
		expect(
			["4242.json", "4242.abc123.key", "4242.abc.json", "notes.json", "4242.json.tmp"].map(isRegistryFileName),
		).toStrictEqual([true, false, false, false, false]);
	});
});

describe("readSessionRegistry", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "session-registry-test-"));
	});

	afterEach(() => {
		chmodSync(join(dir), 0o700);
		rmSync(dir, {recursive: true, force: true});
	});

	it("parses <pid>.json files, skipping key files, invalid JSON and schema drift", async () => {
		writeFileSync(join(dir, "4242.json"), JSON.stringify(registryFixture()));
		writeFileSync(join(dir, "4343.json"), "{not json");
		writeFileSync(join(dir, "4444.json"), JSON.stringify({...registryFixture({pid: 4444}), surprise: 1}));
		const keyPath = join(dir, "4242.deadbeef.key");
		writeFileSync(keyPath, "secret");
		// Unreadable: any attempt to read it would fail, so a clean result proves it was never opened.
		chmodSync(keyPath, 0o000);

		expect(await readSessionRegistry(dir)).toStrictEqual([registryFixture()]);
	});

	it("reports schema drift, such as a status this schema does not know, instead of dropping it silently", async () => {
		writeFileSync(
			join(dir, "4545.json"),
			JSON.stringify(registryFixture({pid: 4545, status: "sleeping" as "idle"})),
		);
		const drift: string[] = [];

		const entries = await readSessionRegistry(dir, (name, message) => drift.push(`${name}: ${message}`));

		expect({entries, drift}).toStrictEqual({
			entries: [],
			drift: ['4545.json: status Invalid option: expected one of "idle"|"busy"|"waiting"|"shell"'],
		});
	});

	it("returns nothing for a missing directory", async () => {
		expect(await readSessionRegistry(join(dir, "missing"))).toStrictEqual([]);
	});
});

describe("isPidAlive", () => {
	function errno(code: string): Error {
		return Object.assign(new Error(code), {code});
	}

	it("treats a signal-0 success or EPERM as alive and ESRCH as dead", () => {
		expect([
			isPidAlive(1, () => true),
			isPidAlive(1, () => {
				throw errno("EPERM");
			}),
			isPidAlive(1, () => {
				throw errno("ESRCH");
			}),
		]).toStrictEqual([true, true, false]);
	});
});

describe("parsePsStartTimes", () => {
	it("maps each pid to its whitespace-normalized lstart", () => {
		const output = "29098 Sat Oct 10 21:05:20 2026    \n 6970 Fri Oct  9 12:03:29 2026\n\n";

		expect(parsePsStartTimes(output)).toStrictEqual(
			new Map([
				[29098, "Sat Oct 10 21:05:20 2026"],
				[6970, "Fri Oct 9 12:03:29 2026"],
			]),
		);
	});
});

describe("liveRegistryEntries", () => {
	const alive = registryFixture({pid: 100, procStart: "Fri Oct  9 12:03:29 2026"});
	const dead = registryFixture({pid: 200, sessionId: "dead-session"});
	const reused = registryFixture({pid: 300, sessionId: "reused-session", procStart: "Thu Oct  8 01:00:00 2026"});

	it("drops dead pids and pids whose start time no longer matches procStart", async () => {
		const result = await liveRegistryEntries([alive, dead, reused], {
			isAlive: (pid) => pid !== 200,
			readStartTimes: async () =>
				Promise.resolve(
					new Map([
						[100, "Fri Oct 9 12:03:29 2026"],
						[300, "Sat Oct 10 09:00:00 2026"],
					]),
				),
		});

		expect(result).toStrictEqual([alive]);
	});

	it("keeps live pids when start times cannot be read", async () => {
		const result = await liveRegistryEntries([alive, reused], {
			isAlive: () => true,
			readStartTimes: async () => Promise.resolve(null),
		});

		expect(result).toStrictEqual([alive, reused]);
	});

	it("drops a live pid that ps no longer reports", async () => {
		const result = await liveRegistryEntries([alive, reused], {
			isAlive: () => true,
			readStartTimes: async () => Promise.resolve(new Map([[100, "Fri Oct 9 12:03:29 2026"]])),
		});

		expect(result).toStrictEqual([alive]);
	});
});

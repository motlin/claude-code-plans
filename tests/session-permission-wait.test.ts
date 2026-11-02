import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {defaultHerdrPermissionDependencies} from "../src/lib/herdr/permission";
import {sessionAwaitingPermission} from "../src/lib/session-permission-wait";
import {clearSessionRegistry, refreshSessionRegistry} from "../src/lib/session-registry-store";

vi.mock("../src/lib/sse-broadcast", () => (
{
	broadcastTyped: () =>
	{
	},
}));

let dir: string;

async function registerWaiting(waitingFor: string): Promise<void>
{
	writeFileSync(
		join(dir, "4242.json"),
		JSON.stringify(
			{
				pid: 4242,
				sessionId: "session-test-100",
				cwd: "/tmp/test/project",
				startedAt: 946_598_400_000,
				procStart: "Fri Dec 31 00:00:00 1999",
				version: "2.0.0",
				kind: "interactive",
				entrypoint: "cli",
				pidDomain: "darwin",
				status: "waiting",
				waitingFor,
				updatedAt: 946_598_402_000,
				statusUpdatedAt: 946_598_402_000,
			},
		),
	);
	await refreshSessionRegistry(
		dir,
		{
			isAlive: () => true,
			readStartTimes: async () => Promise.resolve(null),
		},
	);
}

beforeEach(() =>
{
	dir = mkdtempSync(join(tmpdir(), "session-permission-wait-test-"));
});

afterEach(() =>
{
	clearSessionRegistry();
	rmSync(
		dir,
		{
			recursive: true,
			force: true,
		},
	);
});

describe("sessionAwaitingPermission", () =>
{
	it("counts the CLI registry's permission prompt with no hook notification, as the session list does", async () =>
	{
		await registerWaiting("permission prompt");

		expect(
			{
				awaiting: sessionAwaitingPermission("session-test-100"),
				endpointSeesPending: defaultHerdrPermissionDependencies.hasPendingPermission("session-test-100"),
			},
		).toStrictEqual(
			{
				awaiting: true,
				endpointSeesPending: true,
			},
		);
	});

	it("does not count a registry wait for plain input", async () =>
	{
		await registerWaiting("input needed");

		expect(
			{
				awaiting: sessionAwaitingPermission("session-test-100"),
				endpointSeesPending: defaultHerdrPermissionDependencies.hasPendingPermission("session-test-100"),
			},
		).toStrictEqual(
			{
				awaiting: false,
				endpointSeesPending: false,
			},
		);
	});

	it("is not pending once the registry entry is gone", () =>
	{
		expect(
			{
				awaiting: sessionAwaitingPermission("session-test-100"),
				endpointSeesPending: defaultHerdrPermissionDependencies.hasPendingPermission("session-test-100"),
			},
		).toStrictEqual(
			{
				awaiting: false,
				endpointSeesPending: false,
			},
		);
	});
});

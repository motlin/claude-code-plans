import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	__pendingLaunchTesting,
	addPendingLaunch,
	clearPendingLaunch,
	findLaunchedRow,
	launchSettledAt,
	readPendingLaunches,
	markPendingLaunchStarted,
	settlePendingLaunch,
	subscribePendingLaunches,
} from "../src/lib/pending-launch-store";

const LAUNCH =
{
	projectId: "-users-dev-app",
	projectName: "app",
	cwd: "/users/dev/app",
	since: 1_000,
	opens: true,
};

afterEach(() =>
{
	vi.useRealTimers();
	__pendingLaunchTesting.reset();
});

describe("pending-launch store", () =>
{
	it("publishes a launch, its herdr id, then drops it on settle or clear, notifying subscribers each time", () =>
	{
		vi.useFakeTimers(
			{
				now: 1_795_000_000_000,
			},
		);
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribePendingLaunches(listener);

		const key = addPendingLaunch(LAUNCH);
		const added = readPendingLaunches();
		markPendingLaunchStarted(key, "s-new");
		const named = readPendingLaunches();
		settlePendingLaunch(key, "s-new");
		const settled = readPendingLaunches();
		const other = addPendingLaunch(
			{
				...LAUNCH,
				since: 2_000,
				opens: false,
			},
		);
		clearPendingLaunch(other);
		unsubscribe();
		addPendingLaunch(LAUNCH);

		expect(
			{
				key,
				other,
				added,
				named,
				settled,
				cleared: readPendingLaunches().length,
				notified: listener.mock.calls.length,
				settledAt: launchSettledAt("s-new"),
				otherSettledAt: launchSettledAt("launch:2000"),
			},
		).toStrictEqual(
			{
				key: "launch:1000",
				other: "launch:2000",
				added: [
					{
						...LAUNCH,
						key: "launch:1000",
						sessionId: null,
					},
				],
				named: [
					{
						...LAUNCH,
						key: "launch:1000",
						sessionId: "s-new",
					},
				],
				settled: [],
				cleared: 1,
				notified: 5,
				settledAt: 1_795_000_000_000,
				otherSettledAt: undefined,
			},
		);
	});

	it("drops a started launch whose row never arrives 15 s after herdr answered, as upstream gives up on a code spawn", () =>
	{
		vi.useFakeTimers(
			{
				now: 1_795_000_000_000,
			},
		);
		const unnamed = addPendingLaunch(LAUNCH);
		const named = addPendingLaunch(
			{
				...LAUNCH,
				since: 2_000,
			},
		);
		const settled = addPendingLaunch(
			{
				...LAUNCH,
				since: 3_000,
			},
		);
		vi.advanceTimersByTime(60_000);
		const unstarted = readPendingLaunches().map((entry) => entry.key);
		markPendingLaunchStarted(unnamed, null);
		markPendingLaunchStarted(named, "s-named");
		markPendingLaunchStarted(settled, "s-settled");
		settlePendingLaunch(settled, "s-settled");
		vi.advanceTimersByTime(14_999);
		const before = readPendingLaunches().map((entry) => [entry.key, entry.sessionId]);
		const listener = vi.fn<() => void>();
		subscribePendingLaunches(listener);
		vi.advanceTimersByTime(1);

		expect(
			{
				unstarted,
				before,
				after: readPendingLaunches(),
				notified: listener.mock.calls.length,
				namedSettledAt: launchSettledAt("s-named"),
			},
		).toStrictEqual(
			{
				unstarted: ["launch:1000", "launch:2000", "launch:3000"],
				before: [
					["launch:1000", null],
					["launch:2000", "s-named"],
				],
				after: [],
				notified: 2,
				namedSettledAt: undefined,
			},
		);
	});

	it("matches the launch's row by herdr's id, else a row created since the launch in its project or a worktree under it", () =>
	{
		const row = (id: string, project: string, created: number) => (
		{
			id,
			project,
			created: new Date(created).toISOString(),
		});
		const launch =
		{
			...LAUNCH,
			key: "launch:1000",
			sessionId: null,
		};

		expect(
			{
				older: findLaunchedRow([row("old", LAUNCH.projectId, 999)], launch),
				elsewhere: findLaunchedRow([row("x", "-users-dev-other", 2_000)], launch),
				project: findLaunchedRow(
					[row("x", "-users-dev-other", 2_000), row("new", LAUNCH.projectId, 1_000)],
					launch,
				),
				worktree: findLaunchedRow([row("wt", "-users-dev-app--claude-worktrees-brave-fox", 1_500)], launch),
				byId: findLaunchedRow(
					[row("herdr", "-anywhere", 0)],
					{
						...launch,
						sessionId: "herdr",
					},
				),
			},
		).toStrictEqual(
			{
				older: null,
				elsewhere: null,
				project: "new",
				worktree: "wt",
				byId: "herdr",
			},
		);
	});
});

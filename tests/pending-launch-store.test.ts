import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	__pendingLaunchTesting,
	addPendingLaunch,
	clearPendingLaunch,
	findLaunchedRow,
	launchSettledAt,
	readPendingLaunches,
	setPendingLaunchSessionId,
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
	__pendingLaunchTesting.reset();
});

describe("pending-launch store", () =>
{
	it("publishes a launch, its herdr id, then drops it on settle or clear, notifying subscribers each time", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribePendingLaunches(listener);

		const key = addPendingLaunch(LAUNCH);
		const added = readPendingLaunches();
		setPendingLaunchSessionId(key, "s-new");
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
				settledAt: Date.now(),
				otherSettledAt: undefined,
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

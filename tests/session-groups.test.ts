import {describe, expect, it} from "vite-plus/test";

import
{
	DEFAULT_SESSION_LIST_PREFS,
	SessionListPrefsSchema,
	buildGroups,
	buildSidebarSections,
	customGroupLaunchTarget,
	migrateSessionListPrefs,
	nextPageCanHoldVisibleRows,
	pinnedGroup,
	type SessionGroup,
	type SessionGroupRow,
	type SessionListPrefs,
} from "../src/lib/session-groups";
import {splitPinned} from "../src/lib/pinned-sessions";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Local time so day boundaries hold in any TZ: 2026-09-29 00:30.
const NOW = new Date(2026, 8, 29, 0, 30).getTime();

function row(sessionId: string, overrides: Partial<SessionGroupRow> = {}): SessionGroupRow
{
	return {
		sessionId,
		title: sessionId,
		bucket: "done",
		project: "alpha",
		archived: false,
		createdAt: NOW - DAY,
		lastActivityAt: NOW - HOUR,
		...overrides,
	};
}

/** Most cases exercise Status grouping, so the helper starts from it rather than the ungrouped default. */
function prefs(overrides: Partial<SessionListPrefs> = {}): SessionListPrefs
{
	return {
		...DEFAULT_SESSION_LIST_PREFS,
		groupBy: "state",
		...overrides,
	};
}

function summarize(groups: SessionGroup<SessionGroupRow>[])
{
	return groups.map((group) => (
	{
		key: group.key,
		label: group.label,
		rows: group.rows.map((r) => r.sessionId),
		hiddenCount: group.hiddenCount,
	}));
}

function doneRows(count: number, prefix = "done", overrides: Partial<SessionGroupRow> = {}): SessionGroupRow[]
{
	return Array.from(
		{
			length: count,
		},
		(_, index) =>
			row(
				`${prefix}-${index}`,
				{
					bucket: "done",
					lastActivityAt: NOW - (index + 1) * 60_000,
					...overrides,
				},
			),
	);
}

function ids(prefix: string, count: number, from = 0): string[]
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => `${prefix}-${from + index}`,
	);
}

function paging(groupRow: SessionGroup<SessionGroupRow> | undefined)
{
	return {
		shown: groupRow?.rows.length,
		hiddenCount: groupRow?.hiddenCount,
		revealCount: groupRow?.revealCount,
		canShowLess: groupRow?.canShowLess,
	};
}

describe("DEFAULT_SESSION_LIST_PREFS", () =>
{
	it("matches the upstream defaults", () =>
	{
		expect(DEFAULT_SESSION_LIST_PREFS).toStrictEqual(
			{
				groupBy: "none",
				sortBy: "activity",
				sortDirection: "desc",
				statusFilter: "active",
				activityDays: "7d",
				showEmptyGroups: false,
				showPrStatus: false,
				showMetadata: false,
				version: 2,
			},
		);
	});
});

describe("buildGroups state mode", () =>
{
	it("orders Needs input, Ready for review, Working, Idle, as upstream does", () =>
	{
		const rows = [
			row(
				"done-1",
				{
					bucket: "done",
					lastActivityAt: NOW - 3 * HOUR,
				},
			),
			row(
				"review-1",
				{
					bucket: "review",
				},
			),
			row(
				"working-1",
				{
					bucket: "working",
				},
			),
			row(
				"blocked-1",
				{
					bucket: "blocked",
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW)).map((group) => group.label)).toStrictEqual([
			"Needs input",
			"Ready for review",
			"Working",
			"Idle",
		]);
	});

	it("omits empty state groups", () =>
	{
		const rows = [
			row(
				"done-1",
				{
					bucket: "done",
					lastActivityAt: NOW - 3 * HOUR,
				},
			),
			row(
				"working-1",
				{
					bucket: "working",
				},
			),
			row(
				"blocked-1",
				{
					bucket: "blocked",
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
			row(
				"done-2",
				{
					bucket: "done",
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
			row(
				"blocked-2",
				{
					bucket: "blocked",
					lastActivityAt: NOW - HOUR,
				},
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-blocked",
				label: "Needs input",
				rows: ["blocked-2", "blocked-1"],
				hiddenCount: 0,
			},
			{
				key: "state-working",
				label: "Working",
				rows: ["working-1"],
				hiddenCount: 0,
			},
			{
				key: "state-done",
				label: "Idle",
				rows: ["done-2", "done-1"],
				hiddenCount: 0,
			},
		]);
	});

	it("nests forks under their family head, bucketed by the family's most urgent member", () =>
	{
		const rows = [
			row(
				"head",
				{
					bucket: "done",
					lastActivityAt: NOW - 3 * HOUR,
				},
			),
			row(
				"child",
				{
					bucket: "blocked",
					forkedFromSessionId: "head",
				},
			),
			row(
				"grandchild",
				{
					bucket: "done",
					forkedFromSessionId: "child",
				},
			),
			row(
				"solo",
				{
					bucket: "done",
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
		];

		const groups = buildGroups(rows, prefs(), NOW);

		expect(summarize(groups)).toStrictEqual([
			{
				key: "state-blocked",
				label: "Needs input",
				rows: ["head"],
				hiddenCount: 0,
			},
			{
				key: "state-done",
				label: "Idle",
				rows: ["solo"],
				hiddenCount: 0,
			},
		]);
		expect(
			groups.map((group) =>
				Object.fromEntries(
					[...group.nested].map(([headId, children]) => [headId, children.map((child) => child.sessionId)]),
				),
			),
		).toStrictEqual([
			{
				head: ["child", "grandchild"],
			},
			{},
		]);
	});

	it("caps every Status bucket at 20 rows and reports the hidden count", () =>
	{
		const rows = [
			...doneRows(23),
			...doneRows(
				22,
				"review",
				{
					bucket: "review",
				},
			),
			...doneRows(
				22,
				"blocked",
				{
					bucket: "blocked",
				},
			),
		];

		expect(
			buildGroups(rows, prefs(), NOW).map((stateGroup) => (
			{
				...summarize([stateGroup])[0],
				hiddenAwaiting: stateGroup.hiddenAwaiting,
			})),
		).toStrictEqual([
			{
				key: "state-blocked",
				label: "Needs input",
				rows: ids("blocked", 20),
				hiddenCount: 2,
				hiddenAwaiting: true,
			},
			{
				key: "state-review",
				label: "Ready for review",
				rows: ids("review", 20),
				hiddenCount: 2,
				hiddenAwaiting: false,
			},
			{
				key: "state-done",
				label: "Idle",
				rows: ids("done", 20),
				hiddenCount: 3,
				hiddenAwaiting: false,
			},
		]);
	});

	it("pages a group 20 rows per Show more click, offering Show less only once nothing is hidden", () =>
	{
		const rows = doneRows(47);
		const page = (extra: number) =>
			paging(
				buildGroups(
					rows,
					prefs(),
					NOW,
					{
						"state-done": extra,
					},
				)[0],
			);

		expect([0, 20, 40].map(page)).toStrictEqual([
			{
				shown: 20,
				hiddenCount: 27,
				revealCount: 20,
				canShowLess: false,
			},
			{
				shown: 40,
				hiddenCount: 7,
				revealCount: 7,
				canShowLess: false,
			},
			{
				shown: 47,
				hiddenCount: 0,
				revealCount: 0,
				canShowLess: true,
			},
		]);
	});

	it("never leaves one row behind Show more, saying the true count on the last page (upstream eb, ie)", () =>
	{
		const page = (count: number, extra: number) =>
			paging(
				buildGroups(
					doneRows(count),
					prefs(),
					NOW,
					{
						"state-done": extra,
					},
				)[0],
			);

		expect(
			{
				atRestPlusOne: page(21, 0),
				lastPageOfOne: page(41, 0),
				afterLastPageOfOne: page(41, 20),
				twoPagesLeft: page(42, 0),
				lastOfTwo: page(42, 20),
				shrankToPlusOne: page(21, 20),
				shrankToPlusTwo: page(22, 20),
			},
		).toStrictEqual(
			{
				atRestPlusOne:
				{
					shown: 21,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: false,
				},
				lastPageOfOne:
				{
					shown: 20,
					hiddenCount: 21,
					revealCount: 21,
					canShowLess: false,
				},
				afterLastPageOfOne:
				{
					shown: 41,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: true,
				},
				twoPagesLeft:
				{
					shown: 20,
					hiddenCount: 22,
					revealCount: 20,
					canShowLess: false,
				},
				lastOfTwo:
				{
					shown: 40,
					hiddenCount: 2,
					revealCount: 2,
					canShowLess: false,
				},
				shrankToPlusOne:
				{
					shown: 21,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: false,
				},
				shrankToPlusTwo:
				{
					shown: 22,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: true,
				},
			},
		);
	});

	it("flags a capped group whose hidden rows include one awaiting input", () =>
	{
		const rows = Array.from(
			{
				length: 22,
			},
			(_, index) =>
				row(
					`row-${String(index).padStart(2, "0")}`,
					{
						bucket: index === 21 ? "blocked" : "done",
						lastActivityAt: NOW - (index + 1) * 60_000,
					},
				),
		);
		const hiddenAwaiting = (sortDirection: SessionListPrefs["sortDirection"]) =>
			buildGroups(
				rows,
				prefs(
					{
						groupBy: "none",
						sortBy: "name",
						sortDirection,
					},
				),
				NOW,
			).map((group) => [group.hiddenCount, group.hiddenAwaiting]);

		expect(
			{
				hidden: hiddenAwaiting("desc"),
				shown: hiddenAwaiting("asc"),
			},
		).toStrictEqual(
			{
				hidden: [[2, true]],
				shown: [[2, false]],
			},
		);
	});

	it("hides non-Working rows older than the Last activity window but keeps Working rows", () =>
	{
		const rows = [
			row(
				"old-working",
				{
					bucket: "working",
					lastActivityAt: NOW - 10 * DAY,
				},
			),
			row(
				"old-blocked",
				{
					bucket: "blocked",
					lastActivityAt: NOW - 10 * DAY,
				},
			),
			row(
				"old-done",
				{
					bucket: "done",
					lastActivityAt: NOW - 8 * DAY,
				},
			),
			row(
				"recent-done",
				{
					bucket: "done",
					lastActivityAt: NOW - 6 * DAY,
				},
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-working",
				label: "Working",
				rows: ["old-working"],
				hiddenCount: 0,
			},
			{
				key: "state-done",
				label: "Idle",
				rows: ["recent-done"],
				hiddenCount: 0,
			},
		]);
		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							activityDays: "1d",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "state-working",
				label: "Working",
				rows: ["old-working"],
				hiddenCount: 0,
			},
		]);
		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							activityDays: "all",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "state-blocked",
				label: "Needs input",
				rows: ["old-blocked"],
				hiddenCount: 0,
			},
			{
				key: "state-working",
				label: "Working",
				rows: ["old-working"],
				hiddenCount: 0,
			},
			{
				key: "state-done",
				label: "Idle",
				rows: ["recent-done", "old-done"],
				hiddenCount: 0,
			},
		]);
	});

	it("keeps rows whose process still runs past the Last activity window and ahead of ended rows in their group", () =>
	{
		const rows = [
			...Array.from(
				{
					length: 22,
				},
				(_, index) =>
					row(
						`ended-${index}`,
						{
							bucket: "done",
							lastActivityAt: NOW - (index + 1) * 60_000,
						},
					),
			),
			row(
				"live-day-old",
				{
					bucket: "done",
					live: true,
					lastActivityAt: NOW - DAY,
				},
			),
			row(
				"live-stale",
				{
					bucket: "done",
					live: true,
					lastActivityAt: NOW - 30 * DAY,
				},
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-done",
				label: "Idle",
				rows: [
					"live-day-old",
					"live-stale",
					...Array.from(
						{
							length: 18,
						},
						(_, index) => `ended-${index}`,
					),
				],
				hiddenCount: 4,
			},
		]);
	});

	it("applies the Last activity window in every grouping mode", () =>
	{
		const rows = [
			row(
				"old-working",
				{
					bucket: "working",
					lastActivityAt: NOW - 10 * DAY,
				},
			),
			row(
				"old-done",
				{
					bucket: "done",
					lastActivityAt: NOW - 8 * DAY,
				},
			),
			row(
				"recent-done",
				{
					bucket: "done",
					lastActivityAt: NOW - 6 * DAY,
				},
			),
		];

		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "none",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "recents",
				label: "Recents",
				rows: ["recent-done", "old-working"],
				hiddenCount: 0,
			},
		]);
	});

	it("shows only archived rows when Status is Archived", () =>
	{
		const rows = [
			row("live"),
			row(
				"archived",
				{
					archived: true,
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
		];

		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							statusFilter: "archived",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "state-done",
				label: "Idle",
				rows: ["archived"],
				hiddenCount: 0,
			},
		]);
	});

	it("hides archived rows unless Status is All", () =>
	{
		const rows = [
			row("live"),
			row(
				"archived",
				{
					archived: true,
					lastActivityAt: NOW - 2 * HOUR,
				},
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-done",
				label: "Idle",
				rows: ["live"],
				hiddenCount: 0,
			},
		]);
		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							statusFilter: "all",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "state-done",
				label: "Idle",
				rows: ["live", "archived"],
				hiddenCount: 0,
			},
		]);
	});
});

describe("buildGroups sort", () =>
{
	const rows = [
		row(
			"b",
			{
				title: "banana",
				createdAt: NOW - 3 * DAY,
				lastActivityAt: NOW - HOUR,
			},
		),
		row(
			"a",
			{
				title: "Apple",
				createdAt: NOW - 1 * DAY,
				lastActivityAt: NOW - 3 * HOUR,
			},
		),
		row(
			"c",
			{
				title: "cherry",
				createdAt: NOW - 2 * DAY,
				lastActivityAt: NOW - 2 * HOUR,
			},
		),
	];

	it("sorts by last activity, newest first", () =>
	{
		expect(
			buildGroups(
				rows,
				prefs(
					{
						sortBy: "activity",
					},
				),
				NOW,
			)[0]?.rows.map((r) => r.sessionId),
		).toStrictEqual(["b", "c", "a"]);
	});

	it("sorts by date created, newest first", () =>
	{
		expect(
			buildGroups(
				rows,
				prefs(
					{
						sortBy: "created",
					},
				),
				NOW,
			)[0]?.rows.map((r) => r.sessionId),
		).toStrictEqual(["a", "c", "b"]);
	});

	it("reverses the order with upstream's Ascending sort direction", () =>
	{
		expect(
			buildGroups(
				rows,
				prefs(
					{
						sortBy: "created",
						sortDirection: "asc",
					},
				),
				NOW,
			)[0]?.rows.map((r) => r.sessionId),
		).toStrictEqual(["b", "c", "a"]);
	});

	it("sorts by name, case-insensitively A to Z", () =>
	{
		expect(
			buildGroups(
				rows,
				prefs(
					{
						sortBy: "name",
					},
				),
				NOW,
			)[0]?.rows.map((r) => r.sessionId),
		).toStrictEqual(["a", "b", "c"]);
	});
});

describe("buildGroups date mode", () =>
{
	it("labels Today, Yesterday, day labels and Older across midnight", () =>
	{
		const rows = [
			row(
				"today",
				{
					lastActivityAt: new Date(2026, 8, 29, 0, 1).getTime(),
				},
			),
			row(
				"yesterday-late",
				{
					lastActivityAt: new Date(2026, 8, 28, 23, 59).getTime(),
				},
			),
			row(
				"yesterday-early",
				{
					lastActivityAt: new Date(2026, 8, 28, 0, 0).getTime(),
				},
			),
			row(
				"sep-26",
				{
					lastActivityAt: new Date(2026, 8, 26, 12, 0).getTime(),
				},
			),
			row(
				"sep-23",
				{
					lastActivityAt: new Date(2026, 8, 23, 0, 0).getTime(),
				},
			),
			row(
				"older",
				{
					lastActivityAt: new Date(2026, 8, 22, 23, 59).getTime(),
				},
			),
		];

		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "date",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "date-today",
				label: "Today",
				rows: ["today"],
				hiddenCount: 0,
			},
			{
				key: "date-yesterday",
				label: "Yesterday",
				rows: ["yesterday-late", "yesterday-early"],
				hiddenCount: 0,
			},
			{
				key: "date-2026-09-26",
				label: "Sep 26",
				rows: ["sep-26"],
				hiddenCount: 0,
			},
			{
				key: "date-2026-09-23",
				label: "Sep 23",
				rows: ["sep-23"],
				hiddenCount: 0,
			},
			{
				key: "date-older",
				label: "Older",
				rows: ["older"],
				hiddenCount: 0,
			},
		]);
	});

	it("caps Older at 20 rows", () =>
	{
		const rows = Array.from(
			{
				length: 25,
			},
			(_, index) =>
				row(
					`old-${index}`,
					{
						lastActivityAt: NOW - (30 + index) * DAY,
					},
				),
		);

		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "date",
							activityDays: "all",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "date-older",
				label: "Older",
				rows: ids("old", 20),
				hiddenCount: 5,
			},
		]);
	});

	it("caps every Date bucket at 20, Today included", () =>
	{
		const today = (revealed: Readonly<Record<string, number>>) =>
			paging(
				buildGroups(
					doneRows(22, "today"),
					prefs(
						{
							groupBy: "date",
						},
					),
					NOW,
					revealed,
				).find((dateGroup) => dateGroup.key === "date-today"),
			);

		expect(
			{
				rest: today({}),
				revealed: today(
					{
						"date-today": 20,
					},
				),
			},
		).toStrictEqual(
			{
				rest:
				{
					shown: 20,
					hiddenCount: 2,
					revealCount: 2,
					canShowLess: false,
				},
				revealed:
				{
					shown: 22,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: true,
				},
			},
		);
	});
});

describe("buildGroups project mode", () =>
{
	const rows = [
		row(
			"zeta-1",
			{
				project: "zeta",
			},
		),
		row(
			"none-1",
			{
				project: null,
			},
		),
		row(
			"alpha-1",
			{
				project: "alpha",
				lastActivityAt: NOW - 2 * HOUR,
			},
		),
		row(
			"Beta-1",
			{
				project: "Beta",
			},
		),
		row(
			"alpha-2",
			{
				project: "alpha",
			},
		),
		row(
			"zeta-archived",
			{
				project: "zeta-archived",
				archived: true,
			},
		),
	];

	it("groups by project A to Z with Other last and omits emptied groups", () =>
	{
		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "project",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "project-alpha",
				label: "alpha",
				rows: ["alpha-2", "alpha-1"],
				hiddenCount: 0,
			},
			{
				key: "project-Beta",
				label: "Beta",
				rows: ["Beta-1"],
				hiddenCount: 0,
			},
			{
				key: "project-zeta",
				label: "zeta",
				rows: ["zeta-1"],
				hiddenCount: 0,
			},
			{
				key: "project-__no_project__",
				label: "Other",
				rows: ["none-1"],
				hiddenCount: 0,
			},
		]);
	});

	it("keeps filtered-out projects as empty groups when Show empty groups is on", () =>
	{
		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "project",
							showEmptyGroups: true,
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "project-alpha",
				label: "alpha",
				rows: ["alpha-2", "alpha-1"],
				hiddenCount: 0,
			},
			{
				key: "project-Beta",
				label: "Beta",
				rows: ["Beta-1"],
				hiddenCount: 0,
			},
			{
				key: "project-zeta",
				label: "zeta",
				rows: ["zeta-1"],
				hiddenCount: 0,
			},
			{
				key: "project-zeta-archived",
				label: "zeta-archived",
				rows: [],
				hiddenCount: 0,
			},
			{
				key: "project-__no_project__",
				label: "Other",
				rows: ["none-1"],
				hiddenCount: 0,
			},
		]);
	});
});

describe("buildGroups project mode caps", () =>
{
	it("caps every Project bucket at 20", () =>
	{
		expect(
			summarize(
				buildGroups(
					[
						...doneRows(22, "alpha"),
						...doneRows(
							2,
							"other",
							{
								project: null,
							},
						),
					],
					prefs(
						{
							groupBy: "project",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "project-alpha",
				label: "alpha",
				rows: ids("alpha", 20),
				hiddenCount: 2,
			},
			{
				key: "project-__no_project__",
				label: "Other",
				rows: ids("other", 2),
				hiddenCount: 0,
			},
		]);
	});
});

describe("buildSidebarSections", () =>
{
	const view =
	{
		sortBy: "activity",
		sortDirection: "desc",
	} as const;
	const manual =
	{
		sections: [
			{
				id: "cg-blog",
				name: "Blog",
				...view,
			},
			{
				id: "cg-gtd",
				name: "GTD",
				...view,
			},
			{
				id: "cg-empty",
				name: "Someday",
				...view,
			},
		],
		assignments:
		{
			"gtd-old": "cg-gtd",
			"gtd-new": "cg-gtd",
			"gtd-manual": "cg-gtd",
			"blog-1": "cg-blog",
			"gtd-archived": "cg-gtd",
			stray: "cg-deleted",
		},
		order:
		{
			"cg-gtd": ["gtd-manual", "gtd-gone"],
		},
	};
	const rows = [
		row(
			"gtd-old",
			{
				lastActivityAt: NOW - 3 * HOUR,
			},
		),
		row(
			"loose-1",
			{
				lastActivityAt: NOW - 2 * HOUR,
				bucket: "blocked",
			},
		),
		row(
			"gtd-new",
			{
				lastActivityAt: NOW - HOUR,
				bucket: "blocked",
			},
		),
		row(
			"gtd-manual",
			{
				lastActivityAt: NOW - 5 * HOUR,
			},
		),
		row("blog-1"),
		row(
			"gtd-archived",
			{
				archived: true,
			},
		),
		row(
			"stray",
			{
				lastActivityAt: NOW - 4 * HOUR,
			},
		),
	];

	function summarizeSections(built: ReturnType<typeof buildSidebarSections<SessionGroupRow>>)
	{
		return {
			manual: built.manual.map((section) => (
			{
				id: section.id,
				group: summarize([section.group])[0],
				subgroups: section.subgroups === null ? null : summarize(section.subgroups),
			})),
			sessions: summarize(built.sessions),
		};
	}

	it("gives each manual section its sessions (manual order first) and groups the rest under Recents", () =>
	{
		expect(summarizeSections(buildSidebarSections(rows, prefs(), NOW, {}, manual))).toStrictEqual(
			{
				manual: [
					{
						id: "cg-blog",
						group:
						{
							key: "custom-cg-blog",
							label: "Blog",
							rows: ["blog-1"],
							hiddenCount: 0,
						},
						subgroups: null,
					},
					{
						id: "cg-gtd",
						group:
						{
							key: "custom-cg-gtd",
							label: "GTD",
							rows: ["gtd-manual", "gtd-new", "gtd-old"],
							hiddenCount: 0,
						},
						subgroups: null,
					},
					{
						id: "cg-empty",
						group:
						{
							key: "custom-cg-empty",
							label: "Someday",
							rows: [],
							hiddenCount: 0,
						},
						subgroups: null,
					},
				],
				sessions: [
					{
						key: "state-blocked",
						label: "Needs input",
						rows: ["loose-1"],
						hiddenCount: 0,
					},
					{
						key: "state-done",
						label: "Idle",
						rows: ["stray"],
						hiddenCount: 0,
					},
				],
			},
		);
	});

	it("sorts a manual section by its own Sort by and splits it by its own Status or Date", () =>
	{
		const own =
		{
			...manual,
			sections: [
				{
					id: "cg-gtd",
					name: "GTD",
					sortBy: "name",
					sortDirection: "desc",
					groupBy: "status",
				},
				{
					id: "cg-blog",
					name: "Blog",
					...view,
					groupBy: "date",
				},
			] as const,
			order: {},
		};
		expect(
			summarizeSections(
				buildSidebarSections(
					rows,
					prefs(
						{
							groupBy: "none",
						},
					),
					NOW,
					{},
					own,
				),
			),
		).toStrictEqual(
			{
				manual: [
					{
						id: "cg-gtd",
						group:
						{
							key: "custom-cg-gtd",
							label: "GTD",
							rows: ["gtd-manual", "gtd-new", "gtd-old"],
							hiddenCount: 0,
						},
						subgroups: [
							{
								key: "section:cg-gtd:state-blocked",
								label: "Needs input",
								rows: ["gtd-new"],
								hiddenCount: 0,
							},
							{
								key: "section:cg-gtd:state-done",
								label: "Idle",
								rows: ["gtd-manual", "gtd-old"],
								hiddenCount: 0,
							},
						],
					},
					{
						id: "cg-blog",
						group:
						{
							key: "custom-cg-blog",
							label: "Blog",
							rows: ["blog-1"],
							hiddenCount: 0,
						},
						subgroups: [
							{
								key: "section:cg-blog:date-yesterday",
								label: "Yesterday",
								rows: ["blog-1"],
								hiddenCount: 0,
							},
						],
					},
				],
				sessions: [
					{
						key: "recents",
						label: "Recents",
						rows: ["loose-1", "stray"],
						hiddenCount: 0,
					},
				],
			},
		);
	});

	it("caps a manual section and its own Status headings at 20, each revealed under its own key", () =>
	{
		const blog = doneRows(22, "blog");
		const sections = (groupBy: "status" | undefined, revealed: Readonly<Record<string, number>>) =>
		{
			const [section] = buildSidebarSections(
				blog,
				prefs(),
				NOW,
				revealed,
				{
					sections: [
						{
							id: "cg-blog",
							name: "Blog",
							...view,
							...(groupBy === undefined
								? {}
								:
									{
										groupBy,
									}),
						},
					],
					assignments: Object.fromEntries(blog.map((blogRow) => [blogRow.sessionId, "cg-blog"])),
					order: {},
				},
			).manual;
			return {
				group: paging(section?.group),
				subgroups: section?.subgroups?.map((subgroup) => [subgroup.key, paging(subgroup)]) ?? null,
			};
		};

		expect(
			{
				flat: sections(undefined, {}),
				flatRevealed: sections(
					undefined,
					{
						"custom-cg-blog": 20,
					},
				),
				status: sections("status", {}).subgroups,
				statusRevealed: sections(
					"status",
					{
						"section:cg-blog:state-done": 20,
					},
				).subgroups,
			},
		).toStrictEqual(
			{
				flat:
				{
					group:
					{
						shown: 20,
						hiddenCount: 2,
						revealCount: 2,
						canShowLess: false,
					},
					subgroups: null,
				},
				flatRevealed:
				{
					group:
					{
						shown: 22,
						hiddenCount: 0,
						revealCount: 0,
						canShowLess: true,
					},
					subgroups: null,
				},
				status: [
					[
						"section:cg-blog:state-done",
						{
							shown: 20,
							hiddenCount: 2,
							revealCount: 2,
							canShowLess: false,
						},
					],
				],
				statusRevealed: [
					[
						"section:cg-blog:state-done",
						{
							shown: 22,
							hiddenCount: 0,
							revealCount: 0,
							canShowLess: true,
						},
					],
				],
			},
		);
	});

	it("leaves pinned rows out of their section once split into the Pinned section", () =>
	{
		const withIds = rows.map((groupRow) => (
		{
			...groupRow,
			id: groupRow.sessionId,
		}));
		const {rest} = splitPinned(
			withIds,
			{
				pinnedIds: ["gtd-new", "blog-1"],
				pinnedOrder: [],
			},
			() => 0,
		);
		const built = buildSidebarSections(rest, prefs(), NOW, {}, manual);
		expect(built.manual.map((section) => section.group.rows.map((r) => r.sessionId))).toStrictEqual([
			[],
			["gtd-manual", "gtd-old"],
			[],
		]);
	});
});

describe("buildGroups none mode", () =>
{
	it("shows all 6 Recents rows instead of hiding one behind Show more", () =>
	{
		const rows = Array.from(
			{
				length: 6,
			},
			(_, index) =>
				row(
					`r-${index}`,
					{
						bucket: index % 2 === 0 ? "working" : "done",
						lastActivityAt: NOW - (index + 1) * 60_000,
					},
				),
		);

		expect(
			summarize(
				buildGroups(
					rows,
					prefs(
						{
							groupBy: "none",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "recents",
				label: "Recents",
				rows: ids("r", 6),
				hiddenCount: 0,
			},
		]);
	});

	it("caps Recents at 20 rows", () =>
	{
		expect(
			summarize(
				buildGroups(
					doneRows(25, "r"),
					prefs(
						{
							groupBy: "none",
						},
					),
					NOW,
				),
			),
		).toStrictEqual([
			{
				key: "recents",
				label: "Recents",
				rows: ids("r", 20),
				hiddenCount: 5,
			},
		]);
	});

	it("returns no groups for no rows", () =>
	{
		expect(
			buildGroups(
				[],
				prefs(
					{
						groupBy: "none",
					},
				),
				NOW,
			),
		).toStrictEqual([]);
	});
});

describe("SessionListPrefsSchema", () =>
{
	it("rejects unknown keys and values", () =>
	{
		expect(
			SessionListPrefsSchema.safeParse(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					extra: 1,
				},
			).success,
		).toBe(false);
		expect(
			SessionListPrefsSchema.safeParse(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy: "folder",
				},
			).success,
		).toBe(false);
	});
});

describe("migrateSessionListPrefs", () =>
{
	it("ungroups Recents when the stored Group by was the retired Custom groups mode", () =>
	{
		const stored =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "custom",
			sortBy: "name",
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				groupBy: "none",
				sortBy: "name",
			},
		);
	});

	it("returns stored prefs when they parse", () =>
	{
		const stored =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "none",
			activityDays: "all",
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: "time",
					sessionSort: "stable",
				},
			),
		).toStrictEqual(stored);
	});

	it("turns off the old default-on PR status in unversioned prefs, bumping them to version 2", () =>
	{
		const stored =
		{
			groupBy: "project",
			sortBy: "name",
			sortDirection: "asc",
			statusFilter: "all",
			activityDays: "30d",
			showEmptyGroups: true,
			showPrStatus: true,
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(
			{
				...stored,
				showPrStatus: false,
				showMetadata: false,
				version: 2,
			},
		);
	});

	it("keeps PR status on when version 2 prefs turned it on after the migration", () =>
	{
		const stored =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			showPrStatus: true,
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(stored);
	});

	it("keeps prefs stored before Show PR status existed, defaulting it off as upstream shows no PR glyph", () =>
	{
		const stored =
		{
			groupBy: "project",
			sortBy: "name",
			statusFilter: "all",
			activityDays: "30d",
			showEmptyGroups: true,
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(
			{
				...stored,
				showPrStatus: false,
				showMetadata: false,
				sortDirection: "desc",
				version: 2,
			},
		);
	});

	it("defaults Metadata off in version 2 prefs saved before it existed, as upstream's default", () =>
	{
		const {showMetadata: _omitted, ...stored} =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			showEmptyGroups: true,
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(
			{
				...stored,
				showMetadata: false,
			},
		);
	});

	it("keeps Metadata on once turned on", () =>
	{
		const stored =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			showMetadata: true,
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(stored);
	});

	it("falls back to defaults with no stored or legacy values", () =>
	{
		expect(
			migrateSessionListPrefs(
				{
					stored: null,
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(DEFAULT_SESSION_LIST_PREFS);
	});

	it("defaults a fresh browser to ungrouped, as upstream", () =>
	{
		expect(
			migrateSessionListPrefs(
				{
					stored: null,
					sessionsGrouping: null,
					sessionSort: null,
				},
			).groupBy,
		).toBe("none");
	});

	it("keeps the Status grouping a browser saved under the old default", () =>
	{
		const stored =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "state",
		};
		expect(
			migrateSessionListPrefs(
				{
					stored: JSON.stringify(stored),
					sessionsGrouping: null,
					sessionSort: null,
				},
			),
		).toStrictEqual(stored);
	});

	it.each<[string | null, string | null, Partial<SessionListPrefs>]>([
		[
			"project",
			"urgency",
			{
				groupBy: "project",
				sortBy: "activity",
			},
		],
		[
			"time",
			"stable",
			{
				groupBy: "date",
				sortBy: "created",
			},
		],
		[
			null,
			"stable",
			{
				sortBy: "created",
			},
		],
		["bogus", "bogus", {}],
	])("migrates sessionsGrouping=%s sessionSort=%s", (sessionsGrouping, sessionSort, expected) =>
	{
		expect(
			migrateSessionListPrefs(
				{
					stored: "{not json",
					sessionsGrouping,
					sessionSort,
				},
			),
		).toStrictEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				...expected,
			},
		);
	});
});

describe("Show less", () =>
{
	const done = Array.from(
		{
			length: 23,
		},
		(_, index) =>
			row(
				`done-${index}`,
				{
					bucket: "done",
					lastActivityAt: NOW - (index + 1) * 60_000,
				},
			),
	);

	it("is offered only on a group expanded past its cap that folding back would hide two rows of", () =>
	{
		const states = (revealed: Readonly<Record<string, number>>, rows: SessionGroupRow[]) =>
			buildGroups(rows, prefs(), NOW, revealed).map((group) => [group.key, group.canShowLess]);

		expect(
			{
				capped: states({}, done),
				expanded: states(
					{
						"state-done": 3,
					},
					done,
				),
				underCap: states(
					{
						"state-done": 20,
					},
					done.slice(0, 5),
				),
				oneOver: states(
					{
						"state-done": 20,
					},
					done.slice(0, 21),
				),
				project: buildGroups(
					done,
					prefs(
						{
							groupBy: "project",
						},
					),
					NOW,
					{
						"project-alpha": 3,
					},
				).map((group) => [group.key, group.canShowLess]),
			},
		).toStrictEqual(
			{
				capped: [["state-done", false]],
				expanded: [["state-done", true]],
				underCap: [["state-done", false]],
				oneOver: [["state-done", false]],
				project: [["project-alpha", true]],
			},
		);
	});
});

describe("nextPageCanHoldVisibleRows", () =>
{
	it("is true while the oldest loaded session is inside the Last activity window, whatever groups hide", () =>
	{
		const rows = [
			row(
				"recent",
				{
					lastActivityAt: NOW - HOUR,
				},
			),
			row(
				"old",
				{
					lastActivityAt: NOW - 8 * DAY,
				},
			),
		];
		expect(
			{
				capped: nextPageCanHoldVisibleRows(doneRows(23), prefs(), NOW),
				sevenDays: nextPageCanHoldVisibleRows(rows, prefs(), NOW),
				all: nextPageCanHoldVisibleRows(
					rows,
					prefs(
						{
							activityDays: "all",
						},
					),
					NOW,
				),
				none: nextPageCanHoldVisibleRows([], prefs(), NOW),
			},
		).toStrictEqual(
			{
				capped: true,
				sevenDays: false,
				all: true,
				none: true,
			},
		);
	});
});

describe("pinnedGroup", () =>
{
	it("caps Pinned at 20 slots and pages it 20 at a time", () =>
	{
		expect(
			{
				rest: paging(pinnedGroup(doneRows(23, "pin"), {})),
				revealed: paging(
					pinnedGroup(
						doneRows(23, "pin"),
						{
							pinned: 20,
						},
					),
				),
				longer: paging(
					pinnedGroup(
						doneRows(45, "pin"),
						{
							pinned: 20,
						},
					),
				),
				six: paging(pinnedGroup(doneRows(6, "pin"), {})),
				pageSize: pinnedGroup(doneRows(1, "pin"), {}).pageSize,
			},
		).toStrictEqual(
			{
				rest:
				{
					shown: 20,
					hiddenCount: 3,
					revealCount: 3,
					canShowLess: false,
				},
				revealed:
				{
					shown: 23,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: true,
				},
				longer:
				{
					shown: 40,
					hiddenCount: 5,
					revealCount: 5,
					canShowLess: false,
				},
				six:
				{
					shown: 6,
					hiddenCount: 0,
					revealCount: 0,
					canShowLess: false,
				},
				pageSize: 20,
			},
		);
	});
});

describe("pinnedGroup with nested families", () =>
{
	it("counts slots, not nested rows, toward the 20-slot page", () =>
	{
		const slots = doneRows(22, "slot");
		const head = slots[0]?.sessionId ?? "";
		const members = doneRows(3, "member");
		const grouped = pinnedGroup(slots, {}, new Map([[head, members]]));
		expect(
			{
				paging: paging(grouped),
				nested: grouped.nested.get(head)?.map((member) => member.sessionId),
				headOf: [...grouped.headOf],
			},
		).toStrictEqual(
			{
				paging:
				{
					shown: 20,
					hiddenCount: 2,
					revealCount: 2,
					canShowLess: false,
				},
				nested: ["member-0", "member-1", "member-2"],
				headOf: [
					["member-0", "slot-0"],
					["member-1", "slot-0"],
					["member-2", "slot-0"],
				],
			},
		);
	});

	it("shows 21 slots whole even when one holds a family", () =>
	{
		const slots = doneRows(21, "slot");
		const head = slots[20]?.sessionId ?? "";
		expect(paging(pinnedGroup(slots, {}, new Map([[head, doneRows(3, "member")]])))).toStrictEqual(
			{
				shown: 21,
				hiddenCount: 0,
				revealCount: 0,
				canShowLess: false,
			},
		);
	});
});

describe("customGroupLaunchTarget", () =>
{
	const PROJECTS = [
		{
			id: "-p-alpha",
			name: "alpha",
			projectPath: "/p/alpha",
		},
		{
			id: "-p-beta",
			name: "beta",
			projectPath: "/p/beta",
		},
		{
			id: "-p-gone",
			name: "gone",
			projectPath: null,
		},
	];

	it("shares the one folder every session runs in", () =>
	{
		expect(
			customGroupLaunchTarget(
				[
					{
						projectId: "-p-alpha",
						lastActivityAt: 1,
					},
					{
						projectId: "-p-alpha",
						lastActivityAt: 3,
					},
					{
						projectId: "-p-gone",
						lastActivityAt: 9,
					},
				],
				PROJECTS,
			),
		).toStrictEqual(
			{
				projectId: "-p-alpha",
				folderName: "alpha",
				rule: "shared",
			},
		);
	});

	it("takes the folder of the most recently active session when they differ", () =>
	{
		expect(
			customGroupLaunchTarget(
				[
					{
						projectId: "-p-alpha",
						lastActivityAt: 5,
					},
					{
						projectId: "-p-beta",
						lastActivityAt: 7,
					},
					{
						projectId: "-p-alpha",
						lastActivityAt: 6,
					},
				],
				PROJECTS,
			),
		).toStrictEqual(
			{
				projectId: "-p-beta",
				folderName: "beta",
				rule: "most_recent",
			},
		);
	});

	it("has no folder for an empty group or one whose folders are gone or unknown", () =>
	{
		expect(
			{
				empty: customGroupLaunchTarget([], PROJECTS),
				folderless: customGroupLaunchTarget(
					[
						{
							projectId: "-p-gone",
							lastActivityAt: 1,
						},
						{
							projectId: "-p-unknown",
							lastActivityAt: 2,
						},
					],
					PROJECTS,
				),
			},
		).toStrictEqual(
			{
				empty:
				{
					projectId: null,
					folderName: null,
					rule: "none",
				},
				folderless:
				{
					projectId: null,
					folderName: null,
					rule: "none",
				},
			},
		);
	});
});

import {describe, expect, it} from "vite-plus/test";

import {
	DEFAULT_SESSION_LIST_PREFS,
	SessionListPrefsSchema,
	buildGroups,
	customGroupLaunchTarget,
	migrateSessionListPrefs,
	shouldLoadNextPage,
	type SessionGroup,
	type SessionGroupRow,
	type SessionListPrefs,
} from "../src/lib/session-groups";
import {splitPinned} from "../src/lib/pinned-sessions";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Local time so day boundaries hold in any TZ: 2026-09-29 00:30.
const NOW = new Date(2026, 8, 29, 0, 30).getTime();

function row(sessionId: string, overrides: Partial<SessionGroupRow> = {}): SessionGroupRow {
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

function prefs(overrides: Partial<SessionListPrefs> = {}): SessionListPrefs {
	return {...DEFAULT_SESSION_LIST_PREFS, ...overrides};
}

function summarize(groups: SessionGroup<SessionGroupRow>[]) {
	return groups.map((group) => ({
		key: group.key,
		label: group.label,
		rows: group.rows.map((r) => r.sessionId),
		hiddenCount: group.hiddenCount,
	}));
}

describe("DEFAULT_SESSION_LIST_PREFS", () => {
	it("matches the upstream defaults", () => {
		expect(DEFAULT_SESSION_LIST_PREFS).toStrictEqual({
			groupBy: "state",
			sortBy: "activity",
			sortDirection: "desc",
			statusFilter: "active",
			activityDays: "7d",
			showEmptyGroups: false,
			showPrStatus: false,
			version: 2,
		});
	});
});

describe("buildGroups state mode", () => {
	it("orders Needs input, Ready for review, Working, Completed, as upstream does", () => {
		const rows = [
			row("done-1", {bucket: "done", lastActivityAt: NOW - 3 * HOUR}),
			row("review-1", {bucket: "review"}),
			row("working-1", {bucket: "working"}),
			row("blocked-1", {bucket: "blocked", lastActivityAt: NOW - 2 * HOUR}),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW)).map((group) => group.label)).toStrictEqual([
			"Needs input",
			"Ready for review",
			"Working",
			"Completed",
		]);
	});

	it("omits empty state groups", () => {
		const rows = [
			row("done-1", {bucket: "done", lastActivityAt: NOW - 3 * HOUR}),
			row("working-1", {bucket: "working"}),
			row("blocked-1", {bucket: "blocked", lastActivityAt: NOW - 2 * HOUR}),
			row("done-2", {bucket: "done", lastActivityAt: NOW - 2 * HOUR}),
			row("blocked-2", {bucket: "blocked", lastActivityAt: NOW - HOUR}),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-blocked",
				label: "Needs input",
				rows: ["blocked-2", "blocked-1"],
				hiddenCount: 0,
			},
			{key: "state-working", label: "Working", rows: ["working-1"], hiddenCount: 0},
			{key: "state-done", label: "Completed", rows: ["done-2", "done-1"], hiddenCount: 0},
		]);
	});

	it("nests forks under their family head, bucketed by the family's most urgent member", () => {
		const rows = [
			row("head", {bucket: "done", lastActivityAt: NOW - 3 * HOUR}),
			row("child", {bucket: "blocked", forkedFromSessionId: "head"}),
			row("grandchild", {bucket: "done", forkedFromSessionId: "child"}),
			row("solo", {bucket: "done", lastActivityAt: NOW - 2 * HOUR}),
		];

		const groups = buildGroups(rows, prefs(), NOW);

		expect(summarize(groups)).toStrictEqual([
			{key: "state-blocked", label: "Needs input", rows: ["head"], hiddenCount: 0},
			{key: "state-done", label: "Completed", rows: ["solo"], hiddenCount: 0},
		]);
		expect(
			groups.map((group) =>
				Object.fromEntries(
					[...group.nested].map(([headId, children]) => [headId, children.map((child) => child.sessionId)]),
				),
			),
		).toStrictEqual([{head: ["child", "grandchild"]}, {}]);
	});

	it("caps Completed at 5 rows and reports the hidden count, leaving other groups uncapped", () => {
		const rows = [
			...Array.from({length: 23}, (_, index) =>
				row(`done-${index}`, {bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000}),
			),
			...Array.from({length: 22}, (_, index) =>
				row(`review-${index}`, {bucket: "review", lastActivityAt: NOW - (index + 1) * 60_000}),
			),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-review",
				label: "Ready for review",
				rows: Array.from({length: 22}, (_, index) => `review-${index}`),
				hiddenCount: 0,
			},
			{
				key: "state-done",
				label: "Completed",
				rows: Array.from({length: 5}, (_, index) => `done-${index}`),
				hiddenCount: 18,
			},
		]);
	});

	it("pages a group 5 rows per Show more click, offering Show less only once nothing is hidden", () => {
		const rows = Array.from({length: 45}, (_, index) =>
			row(`done-${index}`, {bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000}),
		);
		const page = (pages: number) => {
			const [group] = buildGroups(rows, prefs(), NOW, pages === 0 ? {} : {"state-done": pages});
			return {
				shown: group?.rows.length,
				hiddenCount: group?.hiddenCount,
				canShowLess: group?.canShowLess,
				hiddenAwaiting: group?.hiddenAwaiting,
			};
		};

		expect([0, 1, 7, 8, 9].map(page)).toStrictEqual([
			{shown: 5, hiddenCount: 40, canShowLess: false, hiddenAwaiting: false},
			{shown: 10, hiddenCount: 35, canShowLess: false, hiddenAwaiting: false},
			{shown: 40, hiddenCount: 5, canShowLess: false, hiddenAwaiting: false},
			{shown: 45, hiddenCount: 0, canShowLess: true, hiddenAwaiting: false},
			{shown: 45, hiddenCount: 0, canShowLess: true, hiddenAwaiting: false},
		]);
	});

	it("flags a capped group whose hidden rows include one awaiting input", () => {
		const rows = Array.from({length: 7}, (_, index) =>
			row(`row-${index}`, {bucket: index === 6 ? "blocked" : "done", lastActivityAt: NOW - (index + 1) * 60_000}),
		);
		const hiddenAwaiting = (sortDirection: SessionListPrefs["sortDirection"]) =>
			buildGroups(rows, prefs({groupBy: "none", sortBy: "name", sortDirection}), NOW).map((group) => [
				group.hiddenCount,
				group.hiddenAwaiting,
			]);

		expect({hidden: hiddenAwaiting("desc"), shown: hiddenAwaiting("asc")}).toStrictEqual({
			hidden: [[2, true]],
			shown: [[2, false]],
		});
	});

	it("hides non-Working rows older than the Last activity window but keeps Working rows", () => {
		const rows = [
			row("old-working", {bucket: "working", lastActivityAt: NOW - 10 * DAY}),
			row("old-blocked", {bucket: "blocked", lastActivityAt: NOW - 10 * DAY}),
			row("old-done", {bucket: "done", lastActivityAt: NOW - 8 * DAY}),
			row("recent-done", {bucket: "done", lastActivityAt: NOW - 6 * DAY}),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0},
			{key: "state-done", label: "Completed", rows: ["recent-done"], hiddenCount: 0},
		]);
		expect(summarize(buildGroups(rows, prefs({activityDays: "1d"}), NOW))).toStrictEqual([
			{key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0},
		]);
		expect(summarize(buildGroups(rows, prefs({activityDays: "all"}), NOW))).toStrictEqual([
			{key: "state-blocked", label: "Needs input", rows: ["old-blocked"], hiddenCount: 0},
			{key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0},
			{key: "state-done", label: "Completed", rows: ["recent-done", "old-done"], hiddenCount: 0},
		]);
	});

	it("keeps rows whose process still runs past the Last activity window and ahead of ended rows in their group", () => {
		const rows = [
			...Array.from({length: 6}, (_, index) =>
				row(`ended-${index}`, {bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000}),
			),
			row("live-day-old", {bucket: "done", live: true, lastActivityAt: NOW - DAY}),
			row("live-stale", {bucket: "done", live: true, lastActivityAt: NOW - 30 * DAY}),
		];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{
				key: "state-done",
				label: "Completed",
				rows: ["live-day-old", "live-stale", ...Array.from({length: 3}, (_, index) => `ended-${index}`)],
				hiddenCount: 3,
			},
		]);
	});

	it("applies the Last activity window in every grouping mode", () => {
		const rows = [
			row("old-working", {bucket: "working", lastActivityAt: NOW - 10 * DAY}),
			row("old-done", {bucket: "done", lastActivityAt: NOW - 8 * DAY}),
			row("recent-done", {bucket: "done", lastActivityAt: NOW - 6 * DAY}),
		];

		expect(summarize(buildGroups(rows, prefs({groupBy: "none"}), NOW))).toStrictEqual([
			{key: "recents", label: "Recents", rows: ["recent-done", "old-working"], hiddenCount: 0},
		]);
	});

	it("shows only archived rows when Status is Archived", () => {
		const rows = [row("live"), row("archived", {archived: true, lastActivityAt: NOW - 2 * HOUR})];

		expect(summarize(buildGroups(rows, prefs({statusFilter: "archived"}), NOW))).toStrictEqual([
			{key: "state-done", label: "Completed", rows: ["archived"], hiddenCount: 0},
		]);
	});

	it("hides archived rows unless Status is All", () => {
		const rows = [row("live"), row("archived", {archived: true, lastActivityAt: NOW - 2 * HOUR})];

		expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
			{key: "state-done", label: "Completed", rows: ["live"], hiddenCount: 0},
		]);
		expect(summarize(buildGroups(rows, prefs({statusFilter: "all"}), NOW))).toStrictEqual([
			{key: "state-done", label: "Completed", rows: ["live", "archived"], hiddenCount: 0},
		]);
	});
});

describe("buildGroups sort", () => {
	const rows = [
		row("b", {title: "banana", createdAt: NOW - 3 * DAY, lastActivityAt: NOW - HOUR}),
		row("a", {title: "Apple", createdAt: NOW - 1 * DAY, lastActivityAt: NOW - 3 * HOUR}),
		row("c", {title: "cherry", createdAt: NOW - 2 * DAY, lastActivityAt: NOW - 2 * HOUR}),
	];

	it("sorts by last activity, newest first", () => {
		expect(buildGroups(rows, prefs({sortBy: "activity"}), NOW)[0]?.rows.map((r) => r.sessionId)).toStrictEqual([
			"b",
			"c",
			"a",
		]);
	});

	it("sorts by date created, newest first", () => {
		expect(buildGroups(rows, prefs({sortBy: "created"}), NOW)[0]?.rows.map((r) => r.sessionId)).toStrictEqual([
			"a",
			"c",
			"b",
		]);
	});

	it("reverses the order with upstream's Ascending sort direction", () => {
		expect(
			buildGroups(rows, prefs({sortBy: "created", sortDirection: "asc"}), NOW)[0]?.rows.map((r) => r.sessionId),
		).toStrictEqual(["b", "c", "a"]);
	});

	it("sorts by name, case-insensitively A to Z", () => {
		expect(buildGroups(rows, prefs({sortBy: "name"}), NOW)[0]?.rows.map((r) => r.sessionId)).toStrictEqual([
			"a",
			"b",
			"c",
		]);
	});
});

describe("buildGroups date mode", () => {
	it("labels Today, Yesterday, day labels and Older across midnight", () => {
		const rows = [
			row("today", {lastActivityAt: new Date(2026, 8, 29, 0, 1).getTime()}),
			row("yesterday-late", {lastActivityAt: new Date(2026, 8, 28, 23, 59).getTime()}),
			row("yesterday-early", {lastActivityAt: new Date(2026, 8, 28, 0, 0).getTime()}),
			row("sep-26", {lastActivityAt: new Date(2026, 8, 26, 12, 0).getTime()}),
			row("sep-23", {lastActivityAt: new Date(2026, 8, 23, 0, 0).getTime()}),
			row("older", {lastActivityAt: new Date(2026, 8, 22, 23, 59).getTime()}),
		];

		expect(summarize(buildGroups(rows, prefs({groupBy: "date"}), NOW))).toStrictEqual([
			{key: "date-today", label: "Today", rows: ["today"], hiddenCount: 0},
			{
				key: "date-yesterday",
				label: "Yesterday",
				rows: ["yesterday-late", "yesterday-early"],
				hiddenCount: 0,
			},
			{key: "date-2026-09-26", label: "Sep 26", rows: ["sep-26"], hiddenCount: 0},
			{key: "date-2026-09-23", label: "Sep 23", rows: ["sep-23"], hiddenCount: 0},
			{key: "date-older", label: "Older", rows: ["older"], hiddenCount: 0},
		]);
	});

	it("caps Older at 5 rows", () => {
		const rows = Array.from({length: 10}, (_, index) =>
			row(`old-${index}`, {lastActivityAt: NOW - (30 + index) * DAY}),
		);

		expect(summarize(buildGroups(rows, prefs({groupBy: "date", activityDays: "all"}), NOW))).toStrictEqual([
			{
				key: "date-older",
				label: "Older",
				rows: Array.from({length: 5}, (_, index) => `old-${index}`),
				hiddenCount: 5,
			},
		]);
	});
});

describe("buildGroups project mode", () => {
	const rows = [
		row("zeta-1", {project: "zeta"}),
		row("none-1", {project: null}),
		row("alpha-1", {project: "alpha", lastActivityAt: NOW - 2 * HOUR}),
		row("Beta-1", {project: "Beta"}),
		row("alpha-2", {project: "alpha"}),
		row("zeta-archived", {project: "zeta-archived", archived: true}),
	];

	it("groups by project A to Z with Other last and omits emptied groups", () => {
		expect(summarize(buildGroups(rows, prefs({groupBy: "project"}), NOW))).toStrictEqual([
			{key: "project-alpha", label: "alpha", rows: ["alpha-2", "alpha-1"], hiddenCount: 0},
			{key: "project-Beta", label: "Beta", rows: ["Beta-1"], hiddenCount: 0},
			{key: "project-zeta", label: "zeta", rows: ["zeta-1"], hiddenCount: 0},
			{key: "project-__no_project__", label: "Other", rows: ["none-1"], hiddenCount: 0},
		]);
	});

	it("keeps filtered-out projects as empty groups when Show empty groups is on", () => {
		expect(summarize(buildGroups(rows, prefs({groupBy: "project", showEmptyGroups: true}), NOW))).toStrictEqual([
			{key: "project-alpha", label: "alpha", rows: ["alpha-2", "alpha-1"], hiddenCount: 0},
			{key: "project-Beta", label: "Beta", rows: ["Beta-1"], hiddenCount: 0},
			{key: "project-zeta", label: "zeta", rows: ["zeta-1"], hiddenCount: 0},
			{key: "project-zeta-archived", label: "zeta-archived", rows: [], hiddenCount: 0},
			{key: "project-__no_project__", label: "Other", rows: ["none-1"], hiddenCount: 0},
		]);
	});
});

describe("buildGroups custom mode", () => {
	const custom = {
		groups: [
			{id: "cg-blog", name: "Blog"},
			{id: "cg-gtd", name: "GTD"},
			{id: "cg-empty", name: "Someday"},
		],
		assignments: {
			"gtd-old": "cg-gtd",
			"gtd-new": "cg-gtd",
			"gtd-manual": "cg-gtd",
			"blog-1": "cg-blog",
			"gtd-archived": "cg-gtd",
		},
		order: {"cg-gtd": ["gtd-manual", "gtd-gone"]},
	};
	const rows = [
		row("gtd-old", {lastActivityAt: NOW - 3 * HOUR}),
		row("loose-1", {lastActivityAt: NOW - 2 * HOUR}),
		row("gtd-new", {lastActivityAt: NOW - HOUR}),
		row("gtd-manual", {lastActivityAt: NOW - 5 * HOUR}),
		row("blog-1"),
		row("gtd-archived", {archived: true}),
	];

	it("lists the groups in order, then Ungrouped, ordering rows manually first then by Sort by", () => {
		expect(summarize(buildGroups(rows, prefs({groupBy: "custom"}), NOW, {}, custom))).toStrictEqual([
			{key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0},
			{
				key: "custom-cg-gtd",
				label: "GTD",
				rows: ["gtd-manual", "gtd-new", "gtd-old"],
				hiddenCount: 0,
			},
			{key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0},
		]);
	});

	it("shows empty groups when Show empty groups is on", () => {
		expect(
			summarize(
				buildGroups(rows, prefs({groupBy: "custom", sortBy: "name", showEmptyGroups: true}), NOW, {}, custom),
			),
		).toStrictEqual([
			{key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0},
			{
				key: "custom-cg-gtd",
				label: "GTD",
				rows: ["gtd-manual", "gtd-new", "gtd-old"],
				hiddenCount: 0,
			},
			{key: "custom-cg-empty", label: "Someday", rows: [], hiddenCount: 0},
			{key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0},
		]);
	});

	it("omits Ungrouped when every row is grouped and treats unknown groups as Ungrouped", () => {
		expect(
			summarize(
				buildGroups(
					[row("blog-1"), row("stray")],
					prefs({groupBy: "custom"}),
					NOW,
					{},
					{
						...custom,
						assignments: {"blog-1": "cg-blog", stray: "cg-deleted"},
					},
				),
			),
		).toStrictEqual([
			{key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0},
			{key: "custom-ungrouped", label: "Ungrouped", rows: ["stray"], hiddenCount: 0},
		]);
		expect(summarize(buildGroups([row("blog-1")], prefs({groupBy: "custom"}), NOW, {}, custom))).toStrictEqual([
			{key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0},
		]);
	});

	it("puts every row in Ungrouped when no groups are given", () => {
		expect(summarize(buildGroups([row("loose-1")], prefs({groupBy: "custom"}), NOW))).toStrictEqual([
			{key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0},
		]);
	});

	it("leaves pinned rows out of their group once split into the Pinned section", () => {
		const withIds = rows.map((groupRow) => ({...groupRow, id: groupRow.sessionId}));
		const {rest} = splitPinned(withIds, {pinnedIds: ["gtd-new", "blog-1"], pinnedOrder: []}, () => 0);
		expect(summarize(buildGroups(rest, prefs({groupBy: "custom"}), NOW, {}, custom))).toStrictEqual([
			{key: "custom-cg-gtd", label: "GTD", rows: ["gtd-manual", "gtd-old"], hiddenCount: 0},
			{key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0},
		]);
	});
});

describe("buildGroups none mode", () => {
	it("puts every row in Recents capped at 5", () => {
		const rows = Array.from({length: 6}, (_, index) =>
			row(`r-${index}`, {
				bucket: index % 2 === 0 ? "working" : "done",
				lastActivityAt: NOW - (index + 1) * 60_000,
			}),
		);

		expect(summarize(buildGroups(rows, prefs({groupBy: "none"}), NOW))).toStrictEqual([
			{
				key: "recents",
				label: "Recents",
				rows: Array.from({length: 5}, (_, index) => `r-${index}`),
				hiddenCount: 1,
			},
		]);
	});

	it("returns no groups for no rows", () => {
		expect(buildGroups([], prefs({groupBy: "none"}), NOW)).toStrictEqual([]);
	});
});

describe("SessionListPrefsSchema", () => {
	it("rejects unknown keys and values", () => {
		expect(SessionListPrefsSchema.safeParse({...DEFAULT_SESSION_LIST_PREFS, extra: 1}).success).toBe(false);
		expect(SessionListPrefsSchema.safeParse({...DEFAULT_SESSION_LIST_PREFS, groupBy: "folder"}).success).toBe(
			false,
		);
	});
});

describe("migrateSessionListPrefs", () => {
	it("returns stored prefs when they parse", () => {
		const stored = {...DEFAULT_SESSION_LIST_PREFS, groupBy: "none", activityDays: "all"};
		expect(
			migrateSessionListPrefs({
				stored: JSON.stringify(stored),
				sessionsGrouping: "time",
				sessionSort: "stable",
			}),
		).toStrictEqual(stored);
	});

	it("turns off the old default-on PR status in unversioned prefs, bumping them to version 2", () => {
		const stored = {
			groupBy: "project",
			sortBy: "name",
			sortDirection: "asc",
			statusFilter: "all",
			activityDays: "30d",
			showEmptyGroups: true,
			showPrStatus: true,
		};
		expect(
			migrateSessionListPrefs({stored: JSON.stringify(stored), sessionsGrouping: null, sessionSort: null}),
		).toStrictEqual({...stored, showPrStatus: false, version: 2});
	});

	it("keeps PR status on when version 2 prefs turned it on after the migration", () => {
		const stored = {...DEFAULT_SESSION_LIST_PREFS, showPrStatus: true};
		expect(
			migrateSessionListPrefs({stored: JSON.stringify(stored), sessionsGrouping: null, sessionSort: null}),
		).toStrictEqual(stored);
	});

	it("keeps prefs stored before Show PR status existed, defaulting it off as upstream shows no PR glyph", () => {
		const stored = {
			groupBy: "project",
			sortBy: "name",
			statusFilter: "all",
			activityDays: "30d",
			showEmptyGroups: true,
		};
		expect(
			migrateSessionListPrefs({
				stored: JSON.stringify(stored),
				sessionsGrouping: null,
				sessionSort: null,
			}),
		).toStrictEqual({...stored, showPrStatus: false, sortDirection: "desc", version: 2});
	});

	it("falls back to defaults with no stored or legacy values", () => {
		expect(migrateSessionListPrefs({stored: null, sessionsGrouping: null, sessionSort: null})).toStrictEqual(
			DEFAULT_SESSION_LIST_PREFS,
		);
	});

	it.each<[string | null, string | null, Partial<SessionListPrefs>]>([
		["project", "urgency", {groupBy: "project", sortBy: "activity"}],
		["time", "stable", {groupBy: "date", sortBy: "created"}],
		[null, "stable", {sortBy: "created"}],
		["bogus", "bogus", {}],
	])("migrates sessionsGrouping=%s sessionSort=%s", (sessionsGrouping, sessionSort, expected) => {
		expect(migrateSessionListPrefs({stored: "{not json", sessionsGrouping, sessionSort})).toStrictEqual(
			prefs(expected),
		);
	});
});

describe("Show less", () => {
	const done = Array.from({length: 23}, (_, index) =>
		row(`done-${index}`, {bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000}),
	);

	it("is offered only on a cappable group expanded past its cap", () => {
		const states = (revealed: Readonly<Record<string, number>>, rows: SessionGroupRow[]) =>
			buildGroups(rows, prefs(), NOW, revealed).map((group) => [group.key, group.canShowLess]);

		expect({
			capped: states({}, done),
			expanded: states({"state-done": 4}, done),
			underCap: states({"state-done": 1}, done.slice(0, 5)),
			project: buildGroups(done, prefs({groupBy: "project"}), NOW, {"project-alpha": 4}).map((group) => [
				group.key,
				group.canShowLess,
			]),
		}).toStrictEqual({
			capped: [["state-done", false]],
			expanded: [["state-done", true]],
			underCap: [["state-done", false]],
			project: [["project-alpha", false]],
		});
	});
});

describe("shouldLoadNextPage", () => {
	const done = Array.from({length: 23}, (_, index) =>
		row(`done-${index}`, {bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000}),
	);

	it("waits while a group still hides rows behind Show N more", () => {
		const groups = buildGroups(done, prefs(), NOW);
		expect(shouldLoadNextPage(groups, done, prefs(), NOW)).toBe(false);
	});

	it("loads once every group shows all its rows", () => {
		const groups = buildGroups(done, prefs(), NOW, {"state-done": 4});
		expect(shouldLoadNextPage(groups, done, prefs(), NOW)).toBe(true);
	});

	it("stops once the oldest loaded session falls outside the Last activity window", () => {
		const rows = [row("recent", {lastActivityAt: NOW - HOUR}), row("old", {lastActivityAt: NOW - 8 * DAY})];
		const groups = buildGroups(rows, prefs(), NOW);
		expect({
			sevenDays: shouldLoadNextPage(groups, rows, prefs(), NOW),
			all: shouldLoadNextPage(groups, rows, prefs({activityDays: "all"}), NOW),
		}).toStrictEqual({sevenDays: false, all: true});
	});
});

describe("customGroupLaunchTarget", () => {
	const PROJECTS = [
		{id: "-p-alpha", name: "alpha", projectPath: "/p/alpha"},
		{id: "-p-beta", name: "beta", projectPath: "/p/beta"},
		{id: "-p-gone", name: "gone", projectPath: null},
	];

	it("shares the one folder every session runs in", () => {
		expect(
			customGroupLaunchTarget(
				[
					{projectId: "-p-alpha", lastActivityAt: 1},
					{projectId: "-p-alpha", lastActivityAt: 3},
					{projectId: "-p-gone", lastActivityAt: 9},
				],
				PROJECTS,
			),
		).toStrictEqual({projectId: "-p-alpha", folderName: "alpha", rule: "shared"});
	});

	it("takes the folder of the most recently active session when they differ", () => {
		expect(
			customGroupLaunchTarget(
				[
					{projectId: "-p-alpha", lastActivityAt: 5},
					{projectId: "-p-beta", lastActivityAt: 7},
					{projectId: "-p-alpha", lastActivityAt: 6},
				],
				PROJECTS,
			),
		).toStrictEqual({projectId: "-p-beta", folderName: "beta", rule: "most_recent"});
	});

	it("has no folder for an empty group or one whose folders are gone or unknown", () => {
		expect({
			empty: customGroupLaunchTarget([], PROJECTS),
			folderless: customGroupLaunchTarget(
				[
					{projectId: "-p-gone", lastActivityAt: 1},
					{projectId: "-p-unknown", lastActivityAt: 2},
				],
				PROJECTS,
			),
		}).toStrictEqual({
			empty: {projectId: null, folderName: null, rule: "none"},
			folderless: {projectId: null, folderName: null, rule: "none"},
		});
	});
});

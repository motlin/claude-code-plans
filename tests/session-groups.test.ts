import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SESSION_LIST_PREFS,
  SessionListPrefsSchema,
  buildGroups,
  filterLabel,
  migrateSessionListPrefs,
  type SessionGroup,
  type SessionGroupRow,
  type SessionListPrefs,
} from "../src/lib/session-groups";
import { splitPinned } from "../src/lib/pinned-sessions";

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
  return { ...DEFAULT_SESSION_LIST_PREFS, ...overrides };
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
      statusFilter: "active",
      activityDays: "7d",
      showEmptyGroups: false,
      showPrStatus: true,
    });
  });
});

describe("buildGroups state mode", () => {
  it("orders Needs input, Ready for review, Working, Completed and omits empty groups", () => {
    const rows = [
      row("done-1", { bucket: "done", lastActivityAt: NOW - 3 * HOUR }),
      row("working-1", { bucket: "working" }),
      row("blocked-1", { bucket: "blocked", lastActivityAt: NOW - 2 * HOUR }),
      row("done-2", { bucket: "done", lastActivityAt: NOW - 2 * HOUR }),
      row("blocked-2", { bucket: "blocked", lastActivityAt: NOW - HOUR }),
    ];

    expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
      {
        key: "state-blocked",
        label: "Needs input",
        rows: ["blocked-2", "blocked-1"],
        hiddenCount: 0,
      },
      { key: "state-working", label: "Working", rows: ["working-1"], hiddenCount: 0 },
      { key: "state-done", label: "Completed", rows: ["done-2", "done-1"], hiddenCount: 0 },
    ]);
  });

  it("nests forks under their family head, bucketed by the family's most urgent member", () => {
    const rows = [
      row("head", { bucket: "done", lastActivityAt: NOW - 3 * HOUR }),
      row("child", { bucket: "blocked", forkedFromSessionId: "head" }),
      row("grandchild", { bucket: "done", forkedFromSessionId: "child" }),
      row("solo", { bucket: "done", lastActivityAt: NOW - 2 * HOUR }),
    ];

    const groups = buildGroups(rows, prefs(), NOW);

    expect(summarize(groups)).toStrictEqual([
      { key: "state-blocked", label: "Needs input", rows: ["head"], hiddenCount: 0 },
      { key: "state-done", label: "Completed", rows: ["solo"], hiddenCount: 0 },
    ]);
    expect(
      groups.map((group) =>
        Object.fromEntries(
          [...group.nested].map(([headId, children]) => [
            headId,
            children.map((child) => child.sessionId),
          ]),
        ),
      ),
    ).toStrictEqual([{ head: ["child", "grandchild"] }, {}]);
  });

  it("caps Completed at 20 rows and reports the hidden count, leaving other groups uncapped", () => {
    const rows = [
      ...Array.from({ length: 23 }, (_, index) =>
        row(`done-${index}`, { bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000 }),
      ),
      ...Array.from({ length: 22 }, (_, index) =>
        row(`review-${index}`, { bucket: "review", lastActivityAt: NOW - (index + 1) * 60_000 }),
      ),
    ];

    expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
      {
        key: "state-review",
        label: "Ready for review",
        rows: Array.from({ length: 22 }, (_, index) => `review-${index}`),
        hiddenCount: 0,
      },
      {
        key: "state-done",
        label: "Completed",
        rows: Array.from({ length: 20 }, (_, index) => `done-${index}`),
        hiddenCount: 3,
      },
    ]);
  });

  it("leaves groups whose Show N more was clicked uncapped", () => {
    const rows = Array.from({ length: 23 }, (_, index) =>
      row(`done-${index}`, { bucket: "done", lastActivityAt: NOW - (index + 1) * 60_000 }),
    );

    expect(summarize(buildGroups(rows, prefs(), NOW, new Set(["state-done"])))).toStrictEqual([
      {
        key: "state-done",
        label: "Completed",
        rows: Array.from({ length: 23 }, (_, index) => `done-${index}`),
        hiddenCount: 0,
      },
    ]);
  });

  it("hides non-Working rows older than the Last activity window but keeps Working rows", () => {
    const rows = [
      row("old-working", { bucket: "working", lastActivityAt: NOW - 10 * DAY }),
      row("old-blocked", { bucket: "blocked", lastActivityAt: NOW - 10 * DAY }),
      row("old-done", { bucket: "done", lastActivityAt: NOW - 8 * DAY }),
      row("recent-done", { bucket: "done", lastActivityAt: NOW - 6 * DAY }),
    ];

    expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
      { key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0 },
      { key: "state-done", label: "Completed", rows: ["recent-done"], hiddenCount: 0 },
    ]);
    expect(summarize(buildGroups(rows, prefs({ activityDays: "1d" }), NOW))).toStrictEqual([
      { key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0 },
    ]);
    expect(summarize(buildGroups(rows, prefs({ activityDays: "all" }), NOW))).toStrictEqual([
      { key: "state-blocked", label: "Needs input", rows: ["old-blocked"], hiddenCount: 0 },
      { key: "state-working", label: "Working", rows: ["old-working"], hiddenCount: 0 },
      { key: "state-done", label: "Completed", rows: ["recent-done", "old-done"], hiddenCount: 0 },
    ]);
  });

  it("shows only archived rows when Status is Archived", () => {
    const rows = [row("live"), row("archived", { archived: true, lastActivityAt: NOW - 2 * HOUR })];

    expect(summarize(buildGroups(rows, prefs({ statusFilter: "archived" }), NOW))).toStrictEqual([
      { key: "state-done", label: "Completed", rows: ["archived"], hiddenCount: 0 },
    ]);
  });

  it("hides archived rows unless Status is All", () => {
    const rows = [row("live"), row("archived", { archived: true, lastActivityAt: NOW - 2 * HOUR })];

    expect(summarize(buildGroups(rows, prefs(), NOW))).toStrictEqual([
      { key: "state-done", label: "Completed", rows: ["live"], hiddenCount: 0 },
    ]);
    expect(summarize(buildGroups(rows, prefs({ statusFilter: "all" }), NOW))).toStrictEqual([
      { key: "state-done", label: "Completed", rows: ["live", "archived"], hiddenCount: 0 },
    ]);
  });
});

describe("buildGroups sort", () => {
  const rows = [
    row("b", { title: "banana", createdAt: NOW - 3 * DAY, lastActivityAt: NOW - HOUR }),
    row("a", { title: "Apple", createdAt: NOW - 1 * DAY, lastActivityAt: NOW - 3 * HOUR }),
    row("c", { title: "cherry", createdAt: NOW - 2 * DAY, lastActivityAt: NOW - 2 * HOUR }),
  ];

  it("sorts by last activity, newest first", () => {
    expect(
      buildGroups(rows, prefs({ sortBy: "activity" }), NOW)[0]?.rows.map((r) => r.sessionId),
    ).toStrictEqual(["b", "c", "a"]);
  });

  it("sorts by date created, newest first", () => {
    expect(
      buildGroups(rows, prefs({ sortBy: "created" }), NOW)[0]?.rows.map((r) => r.sessionId),
    ).toStrictEqual(["a", "c", "b"]);
  });

  it("sorts by name, case-insensitively A to Z", () => {
    expect(
      buildGroups(rows, prefs({ sortBy: "name" }), NOW)[0]?.rows.map((r) => r.sessionId),
    ).toStrictEqual(["a", "b", "c"]);
  });
});

describe("buildGroups date mode", () => {
  it("labels Today, Yesterday, day labels and Older across midnight", () => {
    const rows = [
      row("today", { lastActivityAt: new Date(2026, 8, 29, 0, 1).getTime() }),
      row("yesterday-late", { lastActivityAt: new Date(2026, 8, 28, 23, 59).getTime() }),
      row("yesterday-early", { lastActivityAt: new Date(2026, 8, 28, 0, 0).getTime() }),
      row("sep-26", { lastActivityAt: new Date(2026, 8, 26, 12, 0).getTime() }),
      row("sep-23", { lastActivityAt: new Date(2026, 8, 23, 0, 0).getTime() }),
      row("older", { lastActivityAt: new Date(2026, 8, 22, 23, 59).getTime() }),
    ];

    expect(summarize(buildGroups(rows, prefs({ groupBy: "date" }), NOW))).toStrictEqual([
      { key: "date-today", label: "Today", rows: ["today"], hiddenCount: 0 },
      {
        key: "date-yesterday",
        label: "Yesterday",
        rows: ["yesterday-late", "yesterday-early"],
        hiddenCount: 0,
      },
      { key: "date-2026-09-26", label: "Sep 26", rows: ["sep-26"], hiddenCount: 0 },
      { key: "date-2026-09-23", label: "Sep 23", rows: ["sep-23"], hiddenCount: 0 },
      { key: "date-older", label: "Older", rows: ["older"], hiddenCount: 0 },
    ]);
  });

  it("caps Older at 20 rows and ignores the Last activity window", () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row(`old-${index}`, { lastActivityAt: NOW - (30 + index) * DAY }),
    );

    expect(summarize(buildGroups(rows, prefs({ groupBy: "date" }), NOW))).toStrictEqual([
      {
        key: "date-older",
        label: "Older",
        rows: Array.from({ length: 20 }, (_, index) => `old-${index}`),
        hiddenCount: 5,
      },
    ]);
  });
});

describe("buildGroups project mode", () => {
  const rows = [
    row("zeta-1", { project: "zeta" }),
    row("none-1", { project: null }),
    row("alpha-1", { project: "alpha", lastActivityAt: NOW - 2 * HOUR }),
    row("Beta-1", { project: "Beta" }),
    row("alpha-2", { project: "alpha" }),
    row("zeta-archived", { project: "zeta-archived", archived: true }),
  ];

  it("groups by project A to Z with Other last and omits emptied groups", () => {
    expect(summarize(buildGroups(rows, prefs({ groupBy: "project" }), NOW))).toStrictEqual([
      { key: "project-alpha", label: "alpha", rows: ["alpha-2", "alpha-1"], hiddenCount: 0 },
      { key: "project-Beta", label: "Beta", rows: ["Beta-1"], hiddenCount: 0 },
      { key: "project-zeta", label: "zeta", rows: ["zeta-1"], hiddenCount: 0 },
      { key: "project-__no_project__", label: "Other", rows: ["none-1"], hiddenCount: 0 },
    ]);
  });

  it("keeps filtered-out projects as empty groups when Show empty groups is on", () => {
    expect(
      summarize(buildGroups(rows, prefs({ groupBy: "project", showEmptyGroups: true }), NOW)),
    ).toStrictEqual([
      { key: "project-alpha", label: "alpha", rows: ["alpha-2", "alpha-1"], hiddenCount: 0 },
      { key: "project-Beta", label: "Beta", rows: ["Beta-1"], hiddenCount: 0 },
      { key: "project-zeta", label: "zeta", rows: ["zeta-1"], hiddenCount: 0 },
      { key: "project-zeta-archived", label: "zeta-archived", rows: [], hiddenCount: 0 },
      { key: "project-__no_project__", label: "Other", rows: ["none-1"], hiddenCount: 0 },
    ]);
  });
});

describe("buildGroups custom mode", () => {
  const custom = {
    groups: [
      { id: "cg-blog", name: "Blog" },
      { id: "cg-gtd", name: "GTD" },
      { id: "cg-empty", name: "Someday" },
    ],
    assignments: {
      "gtd-old": "cg-gtd",
      "gtd-new": "cg-gtd",
      "gtd-manual": "cg-gtd",
      "blog-1": "cg-blog",
      "gtd-archived": "cg-gtd",
    },
    order: { "cg-gtd": ["gtd-manual", "gtd-gone"] },
  };
  const rows = [
    row("gtd-old", { lastActivityAt: NOW - 3 * HOUR }),
    row("loose-1", { lastActivityAt: NOW - 2 * HOUR }),
    row("gtd-new", { lastActivityAt: NOW - HOUR }),
    row("gtd-manual", { lastActivityAt: NOW - 5 * HOUR }),
    row("blog-1"),
    row("gtd-archived", { archived: true }),
  ];

  it("lists the groups in order, then Ungrouped, ordering rows manually first then by Sort by", () => {
    expect(
      summarize(buildGroups(rows, prefs({ groupBy: "custom" }), NOW, new Set(), custom)),
    ).toStrictEqual([
      { key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0 },
      {
        key: "custom-cg-gtd",
        label: "GTD",
        rows: ["gtd-manual", "gtd-new", "gtd-old"],
        hiddenCount: 0,
      },
      { key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0 },
    ]);
  });

  it("shows empty groups when Show empty groups is on", () => {
    expect(
      summarize(
        buildGroups(
          rows,
          prefs({ groupBy: "custom", sortBy: "name", showEmptyGroups: true }),
          NOW,
          new Set(),
          custom,
        ),
      ),
    ).toStrictEqual([
      { key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0 },
      {
        key: "custom-cg-gtd",
        label: "GTD",
        rows: ["gtd-manual", "gtd-new", "gtd-old"],
        hiddenCount: 0,
      },
      { key: "custom-cg-empty", label: "Someday", rows: [], hiddenCount: 0 },
      { key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0 },
    ]);
  });

  it("omits Ungrouped when every row is grouped and treats unknown groups as Ungrouped", () => {
    expect(
      summarize(
        buildGroups([row("blog-1"), row("stray")], prefs({ groupBy: "custom" }), NOW, new Set(), {
          ...custom,
          assignments: { "blog-1": "cg-blog", stray: "cg-deleted" },
        }),
      ),
    ).toStrictEqual([
      { key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0 },
      { key: "custom-ungrouped", label: "Ungrouped", rows: ["stray"], hiddenCount: 0 },
    ]);
    expect(
      summarize(buildGroups([row("blog-1")], prefs({ groupBy: "custom" }), NOW, new Set(), custom)),
    ).toStrictEqual([{ key: "custom-cg-blog", label: "Blog", rows: ["blog-1"], hiddenCount: 0 }]);
  });

  it("puts every row in Ungrouped when no groups are given", () => {
    expect(
      summarize(buildGroups([row("loose-1")], prefs({ groupBy: "custom" }), NOW)),
    ).toStrictEqual([
      { key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0 },
    ]);
  });

  it("leaves pinned rows out of their group once split into the Pinned section", () => {
    const withIds = rows.map((groupRow) => ({ ...groupRow, id: groupRow.sessionId }));
    const { rest } = splitPinned(
      withIds,
      { pinnedIds: ["gtd-new", "blog-1"], pinnedOrder: [] },
      () => 0,
    );
    expect(
      summarize(buildGroups(rest, prefs({ groupBy: "custom" }), NOW, new Set(), custom)),
    ).toStrictEqual([
      { key: "custom-cg-gtd", label: "GTD", rows: ["gtd-manual", "gtd-old"], hiddenCount: 0 },
      { key: "custom-ungrouped", label: "Ungrouped", rows: ["loose-1"], hiddenCount: 0 },
    ]);
  });
});

describe("buildGroups none mode", () => {
  it("puts every row in Recents capped at 20", () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      row(`r-${index}`, {
        bucket: index % 2 === 0 ? "working" : "done",
        lastActivityAt: NOW - (index + 1) * 60_000,
      }),
    );

    expect(summarize(buildGroups(rows, prefs({ groupBy: "none" }), NOW))).toStrictEqual([
      {
        key: "recents",
        label: "Recents",
        rows: Array.from({ length: 20 }, (_, index) => `r-${index}`),
        hiddenCount: 1,
      },
    ]);
  });

  it("returns no groups for no rows", () => {
    expect(buildGroups([], prefs({ groupBy: "none" }), NOW)).toStrictEqual([]);
  });
});

describe("filterLabel", () => {
  it.each<[Partial<SessionListPrefs>, string]>([
    [{}, "Filter"],
    [{ groupBy: "date", sortBy: "name", showEmptyGroups: true }, "Filter"],
    [{ statusFilter: "all" }, "Filter (active)"],
    [{ activityDays: "30d" }, "Filter (active)"],
    [{ groupBy: "project", activityDays: "30d" }, "Filter"],
  ])("labels %j as %s", (overrides, expected) => {
    expect(filterLabel(prefs(overrides))).toBe(expected);
  });
});

describe("SessionListPrefsSchema", () => {
  it("rejects unknown keys and values", () => {
    expect(
      SessionListPrefsSchema.safeParse({ ...DEFAULT_SESSION_LIST_PREFS, extra: 1 }).success,
    ).toBe(false);
    expect(
      SessionListPrefsSchema.safeParse({ ...DEFAULT_SESSION_LIST_PREFS, groupBy: "folder" })
        .success,
    ).toBe(false);
  });
});

describe("migrateSessionListPrefs", () => {
  it("returns stored prefs when they parse", () => {
    const stored = { ...DEFAULT_SESSION_LIST_PREFS, groupBy: "none", activityDays: "all" };
    expect(
      migrateSessionListPrefs({
        stored: JSON.stringify(stored),
        sessionsGrouping: "time",
        sessionSort: "stable",
      }),
    ).toStrictEqual(stored);
  });

  it("keeps prefs stored before Show PR status existed, defaulting it on", () => {
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
    ).toStrictEqual({ ...stored, showPrStatus: true });
  });

  it("falls back to defaults with no stored or legacy values", () => {
    expect(
      migrateSessionListPrefs({ stored: null, sessionsGrouping: null, sessionSort: null }),
    ).toStrictEqual(DEFAULT_SESSION_LIST_PREFS);
  });

  it.each<[string | null, string | null, Partial<SessionListPrefs>]>([
    ["project", "urgency", { groupBy: "project", sortBy: "activity" }],
    ["time", "stable", { groupBy: "date", sortBy: "created" }],
    [null, "stable", { sortBy: "created" }],
    ["bogus", "bogus", {}],
  ])("migrates sessionsGrouping=%s sessionSort=%s", (sessionsGrouping, sessionSort, expected) => {
    expect(
      migrateSessionListPrefs({ stored: "{not json", sessionsGrouping, sessionSort }),
    ).toStrictEqual(prefs(expected));
  });
});

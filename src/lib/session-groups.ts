import { z } from "zod";

import { sessionBucketLabels } from "./schema-choices";
import type { SessionBucket } from "./session-state";

export const SessionGroupBySchema = z.enum(["date", "project", "state", "none"]);
type SessionGroupBy = z.infer<typeof SessionGroupBySchema>;

export const SessionSortBySchema = z.enum(["name", "created", "activity"]);
type SessionSortBy = z.infer<typeof SessionSortBySchema>;

/** "active" hides archived sessions, "archived" shows only them, "all" shows both. */
export const SessionStatusFilterSchema = z.enum(["active", "archived", "all"]);
export type SessionStatusFilter = z.infer<typeof SessionStatusFilterSchema>;

export const SessionActivityDaysSchema = z.enum(["1d", "3d", "7d", "30d", "all"]);
type SessionActivityDays = z.infer<typeof SessionActivityDaysSchema>;

export const SessionListPrefsSchema = z
  .object({
    groupBy: SessionGroupBySchema,
    sortBy: SessionSortBySchema,
    statusFilter: SessionStatusFilterSchema,
    activityDays: SessionActivityDaysSchema,
    showEmptyGroups: z.boolean(),
  })
  .strict();
export type SessionListPrefs = z.infer<typeof SessionListPrefsSchema>;

export const DEFAULT_SESSION_LIST_PREFS: SessionListPrefs = {
  groupBy: "state",
  sortBy: "activity",
  statusFilter: "active",
  activityDays: "7d",
  showEmptyGroups: false,
};

export interface SessionGroupRow {
  sessionId: string;
  title: string;
  bucket: SessionBucket;
  project: string | null;
  archived: boolean;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionGroup<Row extends SessionGroupRow> {
  key: string;
  label: string;
  rows: Row[];
  /** Rows past the cap, revealed by the "Show N more" row. */
  hiddenCount: number;
}

/** Completed, Older and Recents show this many rows before "Show N more". */
const GROUP_ROW_CAP = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Date mode gives each of the last few days its own "Sep 26" group; anything earlier is Older. */
const DATED_DAY_COUNT = 7;
const STATE_ORDER: readonly SessionBucket[] = ["blocked", "review", "working", "done"];
const ACTIVITY_WINDOW_DAYS = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
  all: null,
} as const satisfies Record<SessionActivityDays, number | null>;
const NO_PROJECT_KEY = "project-__no_project__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RowComparator = (first: SessionGroupRow, second: SessionGroupRow) => number;

const ROW_COMPARATORS = {
  name: (first, second) =>
    first.title.localeCompare(second.title, undefined, { sensitivity: "base" }) ||
    first.sessionId.localeCompare(second.sessionId),
  created: (first, second) =>
    second.createdAt - first.createdAt || first.sessionId.localeCompare(second.sessionId),
  activity: (first, second) =>
    second.lastActivityAt - first.lastActivityAt || first.sessionId.localeCompare(second.sessionId),
} as const satisfies Record<SessionSortBy, RowComparator>;

/** The filter button reads "Filter (active)" while any non-default filter applies. */
export function filterLabel(prefs: SessionListPrefs): "Filter" | "Filter (active)" {
  const statusActive = prefs.statusFilter !== DEFAULT_SESSION_LIST_PREFS.statusFilter;
  const activityActive =
    prefs.groupBy === "state" && prefs.activityDays !== DEFAULT_SESSION_LIST_PREFS.activityDays;
  return statusActive || activityActive ? "Filter (active)" : "Filter";
}

/** "Clear filters" resets Status and Last activity; grouping and sorting stay. */
export function clearSessionFilters(prefs: SessionListPrefs): SessionListPrefs {
  return {
    ...prefs,
    statusFilter: DEFAULT_SESSION_LIST_PREFS.statusFilter,
    activityDays: DEFAULT_SESSION_LIST_PREFS.activityDays,
  };
}

function isVisible(row: SessionGroupRow, prefs: SessionListPrefs, now: number): boolean {
  if (prefs.statusFilter === "active" && row.archived) return false;
  if (prefs.statusFilter === "archived" && !row.archived) return false;
  const windowDays = ACTIVITY_WINDOW_DAYS[prefs.activityDays];
  if (prefs.groupBy !== "state" || windowDays === null || row.bucket === "working") return true;
  return now - row.lastActivityAt <= windowDays * DAY_MS;
}

function group<Row extends SessionGroupRow>(
  key: string,
  label: string,
  rows: Row[],
  capped: boolean,
): SessionGroup<Row> {
  if (!capped || rows.length <= GROUP_ROW_CAP) return { key, label, rows, hiddenCount: 0 };
  return {
    key,
    label,
    rows: rows.slice(0, GROUP_ROW_CAP),
    hiddenCount: rows.length - GROUP_ROW_CAP,
  };
}

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDayOffset(dayStart: number, todayStart: number): number {
  return Math.round((todayStart - dayStart) / DAY_MS);
}

function dateGroupFor(time: number, todayStart: number): { key: string; label: string } {
  const dayStart = startOfLocalDay(time);
  const offset = localDayOffset(dayStart, todayStart);
  if (offset <= 0) return { key: "date-today", label: "Today" };
  if (offset === 1) return { key: "date-yesterday", label: "Yesterday" };
  if (offset >= DATED_DAY_COUNT) return { key: "date-older", label: "Older" };
  const date = new Date(dayStart);
  const month = date.getMonth();
  const isoDate = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { key: `date-${isoDate}`, label: `${MONTHS[month]} ${date.getDate()}` };
}

function buildDateGroups<Row extends SessionGroupRow>(
  rows: Row[],
  now: number,
  uncapped: ReadonlySet<string>,
): SessionGroup<Row>[] {
  const todayStart = startOfLocalDay(now);
  const byDay = new Map<string, { label: string; dayStart: number; rows: Row[] }>();
  for (const row of rows) {
    const { key, label } = dateGroupFor(row.lastActivityAt, todayStart);
    const dayStart = key === "date-older" ? -Infinity : startOfLocalDay(row.lastActivityAt);
    const existing = byDay.get(key);
    if (existing === undefined) byDay.set(key, { label, dayStart, rows: [row] });
    else existing.rows.push(row);
  }
  return [...byDay.entries()]
    .sort(([, first], [, second]) => second.dayStart - first.dayStart)
    .map(([key, entry]) =>
      group(key, entry.label, entry.rows, key === "date-older" && !uncapped.has(key)),
    );
}

function buildProjectGroups<Row extends SessionGroupRow>(
  allRows: readonly Row[],
  visibleRows: Row[],
  showEmptyGroups: boolean,
): SessionGroup<Row>[] {
  const projects = new Set<string>();
  let hasNoProject = false;
  for (const row of showEmptyGroups ? allRows : visibleRows) {
    if (row.project === null) hasNoProject = true;
    else projects.add(row.project);
  }
  const groups = [...projects]
    .sort((first, second) => first.localeCompare(second, undefined, { sensitivity: "base" }))
    .map((project) =>
      group(
        `project-${project}`,
        project,
        visibleRows.filter((row) => row.project === project),
        false,
      ),
    );
  if (hasNoProject) {
    groups.push(
      group(
        NO_PROJECT_KEY,
        "Other",
        visibleRows.filter((row) => row.project === null),
        false,
      ),
    );
  }
  return groups;
}

/**
 * Pure model behind the sidebar session list and its Filter & group menu,
 * mirroring claude.ai/code's groupings. Empty groups are omitted except in
 * Project mode with Show empty groups on. Groups keyed in `uncapped` (their
 * "Show N more" was clicked) show every row.
 */
export function buildGroups<Row extends SessionGroupRow>(
  rows: readonly Row[],
  prefs: SessionListPrefs,
  now: number,
  uncapped: ReadonlySet<string> = new Set(),
): SessionGroup<Row>[] {
  const visible = rows
    .filter((row) => isVisible(row, prefs, now))
    .sort(ROW_COMPARATORS[prefs.sortBy]);

  switch (prefs.groupBy) {
    case "state":
      return STATE_ORDER.map((bucket) =>
        group(
          `state-${bucket}`,
          sessionBucketLabels[bucket],
          visible.filter((row) => row.bucket === bucket),
          bucket === "done" && !uncapped.has(`state-${bucket}`),
        ),
      ).filter((stateGroup) => stateGroup.rows.length > 0);
    case "date":
      return buildDateGroups(visible, now, uncapped);
    case "project":
      return buildProjectGroups(rows, visible, prefs.showEmptyGroups);
    case "none":
      return visible.length === 0
        ? []
        : [group("recents", "Recents", visible, !uncapped.has("recents"))];
  }
}

const LEGACY_GROUPING = {
  project: "project",
  time: "date",
} as const satisfies Record<string, SessionGroupBy>;

const LEGACY_SORT = {
  urgency: "activity",
  stable: "created",
} as const satisfies Record<string, SessionSortBy>;

function legacyValue<Value>(
  map: Readonly<Record<string, Value>>,
  raw: string | null,
): Value | undefined {
  return raw !== null && Object.hasOwn(map, raw) ? map[raw] : undefined;
}

export interface StoredSessionListPrefs {
  /** The JSON-encoded prefs, if they were ever saved. */
  stored: string | null;
  /** Legacy `ccp-sessions-grouping` value ("project" | "time"). */
  sessionsGrouping: string | null;
  /** Legacy `ccp-session-sort` value ("urgency" | "stable"). */
  sessionSort: string | null;
}

/** Reads persisted prefs, seeding them from the legacy sessionsGrouping/sessionSort settings. */
export function migrateSessionListPrefs(input: StoredSessionListPrefs): SessionListPrefs {
  if (input.stored !== null) {
    try {
      const parsed = SessionListPrefsSchema.safeParse(JSON.parse(input.stored));
      if (parsed.success) return parsed.data;
    } catch {
      // Unparseable JSON falls through to the legacy migration.
    }
  }
  return {
    ...DEFAULT_SESSION_LIST_PREFS,
    groupBy:
      legacyValue(LEGACY_GROUPING, input.sessionsGrouping) ?? DEFAULT_SESSION_LIST_PREFS.groupBy,
    sortBy: legacyValue(LEGACY_SORT, input.sessionSort) ?? DEFAULT_SESSION_LIST_PREFS.sortBy,
  };
}

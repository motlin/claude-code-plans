import {z} from "zod";

import {sessionBucketLabels} from "./schema-choices";
import {resolveFamilies} from "./session-families";
import type {SessionBucket} from "./session-state";

export const SessionGroupBySchema = z.enum(["date", "project", "state", "custom", "none"]);
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
		/** The PR glyph replaces the row dot on sessions with a pull request. */
		showPrStatus: z.boolean(),
	})
	.strict();
export type SessionListPrefs = z.infer<typeof SessionListPrefsSchema>;

export const DEFAULT_SESSION_LIST_PREFS: SessionListPrefs = {
	groupBy: "state",
	sortBy: "activity",
	statusFilter: "active",
	activityDays: "7d",
	showEmptyGroups: false,
	showPrStatus: true,
};

export interface SessionGroupRow {
	sessionId: string;
	title: string;
	bucket: SessionBucket;
	project: string | null;
	archived: boolean;
	createdAt: number;
	lastActivityAt: number;
	/** The session this one was forked from; forks nest under their family head. */
	forkedFromSessionId?: string | undefined;
}

export interface SessionGroup<Row extends SessionGroupRow> {
	key: string;
	label: string;
	rows: Row[];
	/** Rows past the cap, revealed by the "Show N more" row. */
	hiddenCount: number;
	/** The group was expanded past its cap, so a "Show less" row folds it back. */
	canShowLess: boolean;
	/** Family head sessionId → its nested sessions in spawn-tree order, for heads in `rows`. */
	nested: ReadonlyMap<string, Row[]>;
}

/** The user's custom groups (src/lib/session-group-store.ts) as Custom groups mode needs them. */
export interface CustomGroups {
	groups: readonly {id: string; name: string}[];
	/** sessionId → groupId; at most one group per session. */
	assignments: Readonly<Record<string, string>>;
	/** groupId → manual in-group order; unlisted sessions follow the Sort by. */
	order: Readonly<Record<string, readonly string[]>>;
}

const NO_CUSTOM_GROUPS: CustomGroups = {groups: [], assignments: {}, order: {}};

const CUSTOM_UNGROUPED_KEY = "custom-ungrouped";
const CUSTOM_GROUP_KEY_PREFIX = "custom-";

/** The custom group behind a section key, or null for Ungrouped and every other mode. */
export function customGroupIdOfKey(key: string): string | null {
	if (key === CUSTOM_UNGROUPED_KEY || !key.startsWith(CUSTOM_GROUP_KEY_PREFIX)) return null;
	return key.slice(CUSTOM_GROUP_KEY_PREFIX.length);
}

/** Whether a section key is a Project mode section (including "Other"). */
export function isProjectGroupKey(key: string): boolean {
	return key.startsWith("project-");
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
		first.title.localeCompare(second.title, undefined, {sensitivity: "base"}) ||
		first.sessionId.localeCompare(second.sessionId),
	created: (first, second) => second.createdAt - first.createdAt || first.sessionId.localeCompare(second.sessionId),
	activity: (first, second) =>
		second.lastActivityAt - first.lastActivityAt || first.sessionId.localeCompare(second.sessionId),
} as const satisfies Record<SessionSortBy, RowComparator>;

/** The row order a Sort by choice gives; Pinned uses it for pins without a user order. */
export function sessionRowComparator(sortBy: SessionSortBy): RowComparator {
	return ROW_COMPARATORS[sortBy];
}

export const PINNED_GROUP_KEY = "pinned";

/** The sidebar Pinned section as a group: 20 rows, then "Show N more" unless uncapped. */
export function pinnedGroup<Row extends SessionGroupRow>(
	rows: Row[],
	uncapped: ReadonlySet<string>,
): SessionGroup<Row> {
	return group(PINNED_GROUP_KEY, "Pinned", rows, groupCap(true, PINNED_GROUP_KEY, uncapped));
}

/** The filter button reads "Filter (active)" while any non-default filter applies. */
export function filterLabel(prefs: SessionListPrefs): "Filter" | "Filter (active)" {
	const statusActive = prefs.statusFilter !== DEFAULT_SESSION_LIST_PREFS.statusFilter;
	const activityActive = prefs.activityDays !== DEFAULT_SESSION_LIST_PREFS.activityDays;
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
	if (windowDays === null || row.bucket === "working") return true;
	return now - row.lastActivityAt <= windowDays * DAY_MS;
}

/**
 * Whether the next feed page could add rows the list would show: no group still hides
 * rows behind "Show N more", and the oldest loaded session (the feed runs newest first)
 * is still inside the Last activity window.
 */
export function shouldLoadNextPage(
	groups: readonly SessionGroup<SessionGroupRow>[],
	loadedRows: readonly SessionGroupRow[],
	prefs: SessionListPrefs,
	now: number,
): boolean {
	if (groups.some((sessionGroup) => sessionGroup.hiddenCount > 0)) return false;
	const windowDays = ACTIVITY_WINDOW_DAYS[prefs.activityDays];
	if (windowDays === null || loadedRows.length === 0) return true;
	const oldest = loadedRows.reduce((min, row) => Math.min(min, row.lastActivityAt), Infinity);
	return now - oldest <= windowDays * DAY_MS;
}

const NO_NESTED: ReadonlyMap<string, never[]> = new Map();

/** "none": the group never caps; "capped": it stops at the cap; "uncapped": its Show N more was clicked. */
type GroupCap = "none" | "capped" | "uncapped";

function groupCap(cappable: boolean, key: string, uncapped: ReadonlySet<string>): GroupCap {
	if (!cappable) return "none";
	return uncapped.has(key) ? "uncapped" : "capped";
}

function group<Row extends SessionGroupRow>(
	key: string,
	label: string,
	rows: Row[],
	cap: GroupCap,
	allNested: ReadonlyMap<string, Row[]> = NO_NESTED,
): SessionGroup<Row> {
	const overflows = rows.length > GROUP_ROW_CAP;
	const shown = cap === "capped" && overflows ? rows.slice(0, GROUP_ROW_CAP) : rows;
	const nested = new Map<string, Row[]>();
	for (const row of shown) {
		const children = allNested.get(row.sessionId);
		if (children !== undefined) nested.set(row.sessionId, children);
	}
	return {
		key,
		label,
		rows: shown,
		hiddenCount: rows.length - shown.length,
		canShowLess: cap === "uncapped" && overflows,
		nested,
	};
}

function startOfLocalDay(time: number): number {
	const date = new Date(time);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDayOffset(dayStart: number, todayStart: number): number {
	return Math.round((todayStart - dayStart) / DAY_MS);
}

function dateGroupFor(time: number, todayStart: number): {key: string; label: string} {
	const dayStart = startOfLocalDay(time);
	const offset = localDayOffset(dayStart, todayStart);
	if (offset <= 0) return {key: "date-today", label: "Today"};
	if (offset === 1) return {key: "date-yesterday", label: "Yesterday"};
	if (offset >= DATED_DAY_COUNT) return {key: "date-older", label: "Older"};
	const date = new Date(dayStart);
	const month = date.getMonth();
	const isoDate = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return {key: `date-${isoDate}`, label: `${MONTHS[month]} ${date.getDate()}`};
}

function buildDateGroups<Row extends SessionGroupRow>(
	rows: Row[],
	now: number,
	uncapped: ReadonlySet<string>,
	nested: ReadonlyMap<string, Row[]>,
): SessionGroup<Row>[] {
	const todayStart = startOfLocalDay(now);
	const byDay = new Map<string, {label: string; dayStart: number; rows: Row[]}>();
	for (const row of rows) {
		const {key, label} = dateGroupFor(row.lastActivityAt, todayStart);
		const dayStart = key === "date-older" ? -Infinity : startOfLocalDay(row.lastActivityAt);
		const existing = byDay.get(key);
		if (existing === undefined) byDay.set(key, {label, dayStart, rows: [row]});
		else existing.rows.push(row);
	}
	return [...byDay.entries()]
		.sort(([, first], [, second]) => second.dayStart - first.dayStart)
		.map(([key, entry]) =>
			group(key, entry.label, entry.rows, groupCap(key === "date-older", key, uncapped), nested),
		);
}

function buildProjectGroups<Row extends SessionGroupRow>(
	allRows: readonly Row[],
	visibleRows: Row[],
	showEmptyGroups: boolean,
	nested: ReadonlyMap<string, Row[]>,
): SessionGroup<Row>[] {
	const projects = new Set<string>();
	let hasNoProject = false;
	for (const row of showEmptyGroups ? allRows : visibleRows) {
		if (row.project === null) hasNoProject = true;
		else projects.add(row.project);
	}
	const groups = [...projects]
		.sort((first, second) => first.localeCompare(second, undefined, {sensitivity: "base"}))
		.map((project) =>
			group(
				`project-${project}`,
				project,
				visibleRows.filter((row) => row.project === project),
				"none",
				nested,
			),
		);
	if (hasNoProject) {
		groups.push(
			group(
				NO_PROJECT_KEY,
				"Other",
				visibleRows.filter((row) => row.project === null),
				"none",
				nested,
			),
		);
	}
	return groups;
}

function buildCustomGroups<Row extends SessionGroupRow>(
	visibleRows: Row[],
	custom: CustomGroups,
	showEmptyGroups: boolean,
	nested: ReadonlyMap<string, Row[]>,
): SessionGroup<Row>[] {
	const byGroup = new Map<string, Row[]>(custom.groups.map((entry) => [entry.id, []]));
	const ungrouped: Row[] = [];
	for (const row of visibleRows) {
		const groupId = custom.assignments[row.sessionId];
		const groupRows = groupId === undefined ? undefined : byGroup.get(groupId);
		if (groupRows === undefined) ungrouped.push(row);
		else groupRows.push(row);
	}
	const sections = custom.groups.flatMap((entry) => {
		const manual = custom.order[entry.id] ?? [];
		const rank = (row: Row) => {
			const index = manual.indexOf(row.sessionId);
			return index === -1 ? manual.length : index;
		};
		// Array.sort is stable, so rows outside the manual order keep the Sort by order.
		const groupRows = (byGroup.get(entry.id) ?? []).sort((first, second) => rank(first) - rank(second));
		if (groupRows.length === 0 && !showEmptyGroups) return [];
		return [group(`${CUSTOM_GROUP_KEY_PREFIX}${entry.id}`, entry.name, groupRows, "none", nested)];
	});
	if (ungrouped.length > 0) sections.push(group(CUSTOM_UNGROUPED_KEY, "Ungrouped", ungrouped, "none", nested));
	return sections;
}

/**
 * Pure model behind the sidebar session list and its Filter & group menu,
 * mirroring claude.ai/code's groupings. Empty groups are omitted except in
 * Project and Custom groups modes with Show empty groups on. Groups keyed in
 * `uncapped` (their "Show N more" was clicked) show every row. Custom groups
 * mode lists `custom` groups in order, then Ungrouped; callers pass rows with
 * pinned sessions already split out. Forks nest under their family head, which
 * is placed (in State mode) by the family's most urgent member.
 */
export function buildGroups<Row extends SessionGroupRow>(
	rows: readonly Row[],
	prefs: SessionListPrefs,
	now: number,
	uncapped: ReadonlySet<string> = new Set(),
	custom: CustomGroups = NO_CUSTOM_GROUPS,
): SessionGroup<Row>[] {
	const families = resolveFamilies(
		rows.filter((row) => isVisible(row, prefs, now)).sort(ROW_COMPARATORS[prefs.sortBy]),
	);
	const visible = families.map((family) => family.head);
	const familyBucket = new Map(families.map((family) => [family.head.sessionId, family.bucket]));
	const nested = new Map(
		families
			.filter((family) => family.children.length > 0)
			.map((family) => [family.head.sessionId, family.children]),
	);

	switch (prefs.groupBy) {
		case "state":
			return STATE_ORDER.map((bucket) =>
				group(
					`state-${bucket}`,
					sessionBucketLabels[bucket],
					visible.filter((row) => familyBucket.get(row.sessionId) === bucket),
					groupCap(bucket === "done", `state-${bucket}`, uncapped),
					nested,
				),
			).filter((stateGroup) => stateGroup.rows.length > 0);
		case "date":
			return buildDateGroups(visible, now, uncapped, nested);
		case "project":
			return buildProjectGroups(rows, visible, prefs.showEmptyGroups, nested);
		case "custom":
			return buildCustomGroups(visible, custom, prefs.showEmptyGroups, nested);
		case "none":
			return visible.length === 0
				? []
				: [group("recents", "Recents", visible, groupCap(true, "recents", uncapped), nested)];
	}
}

/** The header label the sidebar shows over an empty list, so its Filter control stays reachable. */
export const EMPTY_LIST_GROUP_LABELS = {
	state: sessionBucketLabels.done,
	date: "Today",
	project: "Other",
	custom: "Ungrouped",
	none: "Recents",
} as const satisfies Record<SessionGroupBy, string>;

const LEGACY_GROUPING = {
	project: "project",
	time: "date",
} as const satisfies Record<string, SessionGroupBy>;

const LEGACY_SORT = {
	urgency: "activity",
	stable: "created",
} as const satisfies Record<string, SessionSortBy>;

function legacyValue<Value>(map: Readonly<Record<string, Value>>, raw: string | null): Value | undefined {
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
			// Prefs saved before Show PR status existed lack the field; default it on.
			const parsed = SessionListPrefsSchema.partial({showPrStatus: true}).safeParse(JSON.parse(input.stored));
			if (parsed.success) {
				return {
					...parsed.data,
					showPrStatus: parsed.data.showPrStatus ?? DEFAULT_SESSION_LIST_PREFS.showPrStatus,
				};
			}
		} catch {
			// Unparseable JSON falls through to the legacy migration.
		}
	}
	return {
		...DEFAULT_SESSION_LIST_PREFS,
		groupBy: legacyValue(LEGACY_GROUPING, input.sessionsGrouping) ?? DEFAULT_SESSION_LIST_PREFS.groupBy,
		sortBy: legacyValue(LEGACY_SORT, input.sessionSort) ?? DEFAULT_SESSION_LIST_PREFS.sortBy,
	};
}

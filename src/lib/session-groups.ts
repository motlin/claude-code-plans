import {z} from "zod";

import {sidebarStateGroupLabels} from "./schema-choices";
import {resolveFamilies} from "./session-families";
import type {SessionBucket} from "./session-state";
import {assertNever} from "./assert-never";
import {compareProjectNames, projectSortMode} from "./project-order";
import type {SidebarSection} from "./sidebar-sections";

export const SessionGroupBySchema = z.enum(["date", "project", "state", "none"]);
type SessionGroupBy = z.infer<typeof SessionGroupBySchema>;

export const SessionSortBySchema = z.enum(["name", "created", "activity"]);
export const SessionSortDirectionSchema = z.enum(["desc", "asc"]);
export type SessionSortDirection = z.infer<typeof SessionSortDirectionSchema>;
type SessionSortBy = z.infer<typeof SessionSortBySchema>;

/** "active" hides archived sessions, "archived" shows only them, "all" shows both. */
export const SessionStatusFilterSchema = z.enum(["active", "archived", "all"]);
export type SessionStatusFilter = z.infer<typeof SessionStatusFilterSchema>;

export const SessionActivityDaysSchema = z.enum(["1d", "3d", "7d", "30d", "all"]);
type SessionActivityDays = z.infer<typeof SessionActivityDaysSchema>;

export const SessionListPrefsSchema = z
	.object(
		{
			groupBy: SessionGroupBySchema,
			sortBy: SessionSortBySchema,
			/** Upstream's Sort by ▸ Descending / Ascending: Ascending reverses the sort's order. */
			sortDirection: SessionSortDirectionSchema,
			statusFilter: SessionStatusFilterSchema,
			activityDays: SessionActivityDaysSchema,
			showEmptyGroups: z.boolean(),
			/** The PR glyph replaces the row dot on sessions with a pull request; off by default, as upstream shows none. */
			showPrStatus: z.boolean(),
			/** Upstream's Show ▸ Metadata: two-line rows with the branch, folder or blocked reason; off by default, as upstream. */
			showMetadata: z.boolean(),
			/** 2 since Show PR status defaulted off; unversioned prefs still carry the old default-on value. */
			version: z.literal(2),
		},
	)
	.strict();
export type SessionListPrefs = z.infer<typeof SessionListPrefsSchema>;

export const DEFAULT_SESSION_LIST_PREFS: SessionListPrefs =
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
};

export interface SessionGroupRow
{
	sessionId: string;
	title: string;
	bucket: SessionBucket;
	project: string | null;
	archived: boolean;
	createdAt: number;
	lastActivityAt: number;
	/** The session this one was forked from; forks nest under their family head. */
	forkedFromSessionId?: string | undefined;
	/** Its CLI process still runs, so it skips the Last activity window and leads its state group. */
	live?: boolean | undefined;
}

export interface SessionGroup<Row extends SessionGroupRow>
{
	key: string;
	label: string;
	rows: Row[];
	/** Rows past the cap, revealed a page at a time by the "Show more" row; never 1 (upstream `eb`). */
	hiddenCount: number;
	/** How many rows the next Show more click reveals (upstream `ie`): a page, or every hidden row on the last one. */
	revealCount: number;
	/** A hidden row (or one nested under it) awaits input, so Show more carries an awaiting dot. */
	hiddenAwaiting: boolean;
	/** Every row shows after Show more and folding back would hide at least two, so a "Show less" row folds it back. */
	canShowLess: boolean;
	/** Family head sessionId → its nested sessions in spawn-tree order, for heads in `rows`. */
	nested: ReadonlyMap<string, Row[]>;
	/** `nested` for every head in `sorted`, shown or hidden, for rows a section holds past its cap. */
	allNested: ReadonlyMap<string, Row[]>;
	/** The rows shown before any Show more (upstream `truncateAt`); each Show more page is this many more. */
	pageSize: number;
	/** Rows revealed past the first page (upstream `extraRevealed`). */
	extraRevealed: number;
	/** Every head row, shown or hidden, in display order (upstream `sorted`). */
	sorted: Row[];
	/** Nested sessionId → its family head's sessionId, over `sorted` (upstream `heldBy: headKeyOf`). */
	headOf: ReadonlyMap<string, string>;
}

/** The manual sections (custom groups, src/lib/session-group-store.ts) above Recents, in section order. */
export interface ManualSections
{
	sections: readonly Pick<SidebarSection, "id" | "name" | "groupBy" | "sortBy" | "sortDirection">[];
	/** sessionId → groupId; at most one group per session. */
	assignments: Readonly<Record<string, string>>;
	/** groupId → manual in-group order; unlisted sessions follow the section's Sort by. */
	order: Readonly<Record<string, readonly string[]>>;
}

const CUSTOM_GROUP_KEY_PREFIX = "custom-";

/** A manual section's group key; its collapse state is kept under it. */
function customGroupKey(groupId: string): string
{
	return `${CUSTOM_GROUP_KEY_PREFIX}${groupId}`;
}

/** The custom group behind a manual section's key, or null for every other section. */
export function customGroupIdOfKey(key: string): string | null
{
	if (!key.startsWith(CUSTOM_GROUP_KEY_PREFIX)) return null;
	return key.slice(CUSTOM_GROUP_KEY_PREFIX.length);
}

/** Whether a section key is a Project mode section (including "Other"). */
export function isProjectGroupKey(key: string): boolean
{
	return key.startsWith("project-");
}

/** Upstream `Fs`/`gk`: a folder section's key in the folder order, or null for Other and non-folder sections. */
export function projectOrderKey(groupKey: string): string | null
{
	return isProjectGroupKey(groupKey) && groupKey !== NO_PROJECT_KEY ? groupKey.slice("project-".length) : null;
}

export interface CustomGroupLaunchTarget
{
	/** The project a new session in this custom group launches in, or null when none is known. */
	projectId: string | null;
	folderName: string | null;
	/** Upstream `$R`: one folder shared by every session, else the most recently active session's. */
	rule: "shared" | "most_recent" | "none";
}

/**
 * Where a custom group's + starts a session (upstream `$R` + `wu`): the folder its sessions share,
 * else the folder of the most recently active one. Sessions whose folder is gone don't count.
 */
export function customGroupLaunchTarget(
	rows: readonly
	{
		projectId: string;
		lastActivityAt: number;
	}[],
	projects: readonly
	{
		id: string;
		name: string;
		projectPath: string | null;
	}[],
): CustomGroupLaunchTarget
{
	const launchable = new Map(
		projects.flatMap((project) => (project.projectPath === null ? [] : [[project.id, project]])),
	);
	const placed = rows.filter((row) => launchable.has(row.projectId));
	const newest = placed.reduce<(typeof placed)[number] | undefined>(
		(best, row) => (best === undefined || row.lastActivityAt > best.lastActivityAt ? row : best),
		undefined,
	);
	const project = newest === undefined ? undefined : launchable.get(newest.projectId);
	if (project === undefined)
		return {
			projectId: null,
			folderName: null,
			rule: "none",
		};
	const shared = placed.every((row) => row.projectId === project.id);
	return {
		projectId: project.id,
		folderName: project.name,
		rule: shared ? "shared" : "most_recent",
	};
}

/**
 * Every sidebar section shows this many rows, and each Show more click reveals this many more
 * (upstream `yi = t==="code" ? 20 : void 0`, 2026-11-06; it was 5 when grouped on 2026-11-04).
 */
const GROUP_PAGE_SIZE = 20;

/**
 * Pinned shows this many slots and each Show more reveals this many more (upstream
 * `Ag(slots, 20, collapsed, {heldBy})`, a literal independent of the grouping truncateAt).
 */
const PINNED_PAGE_SIZE = 20;

/** Group key → how many rows the user revealed past the section's first page (upstream `extraRevealed`). */
export type RevealedRows = Readonly<Record<string, number>>;

/**
 * Upstream `eb`: a section hides rows only when two or more would hide, so a page never
 * leaves a single row behind Show more.
 */
export function truncates(length: number, truncateAt: number, extraRevealed: number): boolean
{
	return length > truncateAt + extraRevealed + 1;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Date mode gives each of the last few days its own "Sep 26" group; anything earlier is Older. */
const DATED_DAY_COUNT = 7;
/** Upstream claude.ai/code group order (`zM`): Needs input, Ready for review, Working, Completed. */
const STATE_ORDER: readonly SessionBucket[] = ["blocked", "review", "working", "done"];
const ACTIVITY_WINDOW_DAYS =
{
	"1d": 1,
	"3d": 3,
	"7d": 7,
	"30d": 30,
	all: null,
} as const satisfies Record<SessionActivityDays, number | null>;
const NO_PROJECT_KEY = "project-__no_project__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RowComparator = (first: SessionGroupRow, second: SessionGroupRow) => number;

const ROW_COMPARATORS =
{
	name: (first, second) =>
		first.title.localeCompare(
			second.title,
			undefined,
			{
				sensitivity: "base",
			},
		) || first.sessionId.localeCompare(second.sessionId),
	created: (first, second) => second.createdAt - first.createdAt || first.sessionId.localeCompare(second.sessionId),
	activity: (first, second) =>
		second.lastActivityAt - first.lastActivityAt || first.sessionId.localeCompare(second.sessionId),
} as const satisfies Record<SessionSortBy, RowComparator>;

/** The row order a Sort by choice and direction give; Pinned uses it for pins without a user order. */
export function sessionRowComparator(sortBy: SessionSortBy, direction: SessionSortDirection = "desc"): RowComparator
{
	const compare = ROW_COMPARATORS[sortBy];
	return direction === "desc" ? compare : (first, second) => compare(second, first);
}

export const PINNED_GROUP_KEY = "pinned";

/**
 * The sidebar Pinned section as a group: 20 slots, plus 20 per revealed Show more page. A pinned
 * family head's `nested` rows ride on its slot, as upstream's `Ag(slots, 20, …, {heldBy})`.
 */
export function pinnedGroup<Row extends SessionGroupRow>(
	rows: Row[],
	revealed: RevealedRows,
	nested: ReadonlyMap<string, Row[]> = NO_NESTED,
): SessionGroup<Row>
{
	return group(PINNED_GROUP_KEY, "Pinned", rows, revealed, nested, PINNED_PAGE_SIZE);
}

function isVisible(row: SessionGroupRow, prefs: SessionListPrefs, now: number): boolean
{
	if (prefs.statusFilter === "active" && row.archived) return false;
	if (prefs.statusFilter === "archived" && !row.archived) return false;
	const windowDays = ACTIVITY_WINDOW_DAYS[prefs.activityDays];
	if (windowDays === null || row.bucket === "working" || row.live === true) return true;
	return now - row.lastActivityAt <= windowDays * DAY_MS;
}

/**
 * Whether the next feed page could add rows the list would show: the oldest loaded session (the
 * feed runs newest first) is still inside the Last activity window. Stands in for upstream's
 * server-side `hasMore` activity cutoff.
 */
export function nextPageCanHoldVisibleRows(
	loadedRows: readonly SessionGroupRow[],
	prefs: SessionListPrefs,
	now: number,
): boolean
{
	const windowDays = ACTIVITY_WINDOW_DAYS[prefs.activityDays];
	if (windowDays === null || loadedRows.length === 0) return true;
	const oldest = loadedRows.reduce((min, row) => Math.min(min, row.lastActivityAt), Infinity);
	return now - oldest <= windowDays * DAY_MS;
}

/** Stable: running sessions lead their state group, each half keeping the Sort by order. */
function liveFirst<Row extends SessionGroupRow>(rows: Row[]): Row[]
{
	return [...rows.filter((row) => row.live === true), ...rows.filter((row) => row.live !== true)];
}

const NO_NESTED: ReadonlyMap<string, never[]> = new Map();

/**
 * Upstream `tQ`'s truncation: the first `pageSize` rows plus the rows revealed past them, unless
 * that would hide a single row (`eb`), in which case every row shows.
 */
function group<Row extends SessionGroupRow>(
	key: string,
	label: string,
	rows: Row[],
	revealed: RevealedRows,
	allNested: ReadonlyMap<string, Row[]> = NO_NESTED,
	pageSize: number = GROUP_PAGE_SIZE,
): SessionGroup<Row>
{
	const extraRevealed = revealed[key] ?? 0;
	const shown = truncates(rows.length, pageSize, extraRevealed) ? rows.slice(0, pageSize + extraRevealed) : rows;
	const nested = new Map<string, Row[]>();
	const headOf = new Map<string, string>();
	for (const row of rows)
	{
		const children = allNested.get(row.sessionId);
		if (children === undefined) continue;
		for (const child of children) headOf.set(child.sessionId, row.sessionId);
	}
	for (const row of shown)
	{
		const children = allNested.get(row.sessionId);
		if (children !== undefined) nested.set(row.sessionId, children);
	}
	const hidden = rows.slice(shown.length);
	return {
		key,
		label,
		rows: shown,
		hiddenCount: hidden.length,
		revealCount:
			hidden.length === 0
				? 0
				: truncates(rows.length, pageSize, extraRevealed + pageSize)
					? pageSize
					: hidden.length,
		hiddenAwaiting: hidden.some(
			(row) =>
				row.bucket === "blocked" ||
				(allNested.get(row.sessionId) ?? []).some((child) => child.bucket === "blocked"),
		),
		canShowLess: extraRevealed > 0 && hidden.length === 0 && truncates(rows.length, pageSize, 0),
		nested,
		allNested,
		pageSize,
		extraRevealed,
		sorted: rows,
		headOf,
	};
}

const OLDER_GROUP_KEY = "date-older";

/** Recents' own Date "Older" bucket (upstream `qZ`'s `key === "older"`); a manual section's Older heading is not. */
export function isOlderBucket(group: Pick<SessionGroup<SessionGroupRow>, "key">): boolean
{
	return group.key === OLDER_GROUP_KEY;
}

function startOfLocalDay(time: number): number
{
	const date = new Date(time);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDayOffset(dayStart: number, todayStart: number): number
{
	return Math.round((todayStart - dayStart) / DAY_MS);
}

function dateGroupFor(
	time: number,
	todayStart: number,
):
{
	key: string;
	label: string;
}
{
	const dayStart = startOfLocalDay(time);
	const offset = localDayOffset(dayStart, todayStart);
	if (offset <= 0)
		return {
			key: "date-today",
			label: "Today",
		};
	if (offset === 1)
		return {
			key: "date-yesterday",
			label: "Yesterday",
		};
	if (offset >= DATED_DAY_COUNT)
		return {
			key: OLDER_GROUP_KEY,
			label: "Older",
		};
	const date = new Date(dayStart);
	const month = date.getMonth();
	const isoDate = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return {
		key: `date-${isoDate}`,
		label: `${MONTHS[month]} ${date.getDate()}`,
	};
}

function buildDateGroups<Row extends SessionGroupRow>(
	rows: Row[],
	now: number,
	revealed: RevealedRows,
	nested: ReadonlyMap<string, Row[]>,
	/** A manual section's own date headings (upstream `v8`): keys prefixed with the section's. */
	inSection = "",
): SessionGroup<Row>[]
{
	const todayStart = startOfLocalDay(now);
	const byDay = new Map<
		string,
		{
			label: string;
			dayStart: number;
			rows: Row[];
		}
	>();
	for (const row of rows)
	{
		const {key, label} = dateGroupFor(row.lastActivityAt, todayStart);
		const dayStart = key === OLDER_GROUP_KEY ? -Infinity : startOfLocalDay(row.lastActivityAt);
		const existing = byDay.get(key);
		if (existing === undefined)
			byDay.set(
				key,
				{
					label,
					dayStart,
					rows: [row],
				},
			);
		else existing.rows.push(row);
	}
	return [...byDay.entries()]
		.toSorted(([, first], [, second]) => second.dayStart - first.dayStart)
		.map(([key, entry]) => group(`${inSection}${key}`, entry.label, entry.rows, revealed, nested));
}

function buildProjectGroups<Row extends SessionGroupRow>(
	allRows: readonly Row[],
	visibleRows: Row[],
	showEmptyGroups: boolean,
	nested: ReadonlyMap<string, Row[]>,
	revealed: RevealedRows,
	projectOrder: readonly string[],
): SessionGroup<Row>[]
{
	const latest = new Map<string, number>();
	let hasNoProject = false;
	for (const row of showEmptyGroups ? allRows : visibleRows)
	{
		if (row.project === null) hasNoProject = true;
		else latest.set(row.project, Math.max(latest.get(row.project) ?? -Infinity, row.lastActivityAt));
	}
	const projects = new Set(latest.keys());
	const rank = new Map(projectOrder.map((project, index) => [project, index]));
	// Upstream `vM`: stored projects first in their stored order, the rest newest first; otherwise A to Z.
	const compare =
		projectSortMode(projectOrder, projects) === "name"
			? compareProjectNames
			: (first: string, second: string) =>
				{
					const firstRank = rank.get(first) ?? Infinity;
					const secondRank = rank.get(second) ?? Infinity;
					if (firstRank !== secondRank) return firstRank - secondRank;
					return (latest.get(second) ?? 0) - (latest.get(first) ?? 0) || compareProjectNames(first, second);
				};
	const groups = [...projects].toSorted(compare).map((project) =>
		group(
			`project-${project}`,
			project,
			visibleRows.filter((row) => row.project === project),
			revealed,
			nested,
		),
	);
	if (hasNoProject)
	{
		groups.push(
			group(
				NO_PROJECT_KEY,
				"Other",
				visibleRows.filter((row) => row.project === null),
				revealed,
				nested,
			),
		);
	}
	return groups;
}

/** Visible rows sorted by the list's Sort by, resolved into families. */
interface ResolvedRows<Row extends SessionGroupRow>
{
	/** Family heads, in Sort by order. */
	visible: Row[];
	/** Head sessionId → the family's most urgent bucket. */
	familyBucket: ReadonlyMap<string, SessionBucket>;
	nested: ReadonlyMap<string, Row[]>;
}

function resolveRows<Row extends SessionGroupRow>(
	rows: readonly Row[],
	prefs: SessionListPrefs,
	now: number,
): ResolvedRows<Row>
{
	const families = resolveFamilies(
		rows
			.filter((row) => isVisible(row, prefs, now))
			.toSorted(sessionRowComparator(prefs.sortBy, prefs.sortDirection)),
	);
	return {
		visible: families.map((family) => family.head),
		familyBucket: new Map(families.map((family) => [family.head.sessionId, family.bucket])),
		nested: new Map(
			families
				.filter((family) => family.children.length > 0)
				.map((family) => [family.head.sessionId, family.children]),
		),
	};
}

function stateGroups<Row extends SessionGroupRow>(
	{visible, familyBucket, nested}: ResolvedRows<Row>,
	revealed: RevealedRows,
	inSection = "",
): SessionGroup<Row>[]
{
	return STATE_ORDER.map((bucket) =>
		group(
			`${inSection}state-${bucket}`,
			sidebarStateGroupLabels[bucket],
			liveFirst(visible.filter((row) => familyBucket.get(row.sessionId) === bucket)),
			revealed,
			nested,
		),
	).filter((stateGroup) => stateGroup.rows.length > 0);
}

function groupResolved<Row extends SessionGroupRow>(
	rows: readonly Row[],
	resolved: ResolvedRows<Row>,
	prefs: SessionListPrefs,
	now: number,
	revealed: RevealedRows,
	projectOrder: readonly string[],
): SessionGroup<Row>[]
{
	const {visible, nested} = resolved;
	switch (prefs.groupBy)
	{
		case "state":
			return stateGroups(resolved, revealed);
		case "date":
			return buildDateGroups(visible, now, revealed, nested);
		case "project":
			return buildProjectGroups(rows, visible, prefs.showEmptyGroups, nested, revealed, projectOrder);
		case "none":
			return visible.length === 0 ? [] : [group("recents", "Recents", visible, revealed, nested)];
		default:
			return assertNever(prefs.groupBy);
	}
}

/**
 * Pure model behind the sidebar's Recents list and its Group and sort menu,
 * mirroring claude.ai/code's groupings. Empty groups are omitted except in
 * Project mode with Show empty groups on. Every group shows 20 rows plus the rows
 * `revealed` under its key, never hiding a single row. Callers pass rows with pinned
 * sessions already split out. Forks nest under their family head, which is
 * placed (in State mode) by the family's most urgent member. Project mode follows the stored
 * folder order (`projectOrder`), else A to Z.
 */
export function buildGroups<Row extends SessionGroupRow>(
	rows: readonly Row[],
	prefs: SessionListPrefs,
	now: number,
	revealed: RevealedRows = {},
	projectOrder: readonly string[] = [],
): SessionGroup<Row>[]
{
	return groupResolved(rows, resolveRows(rows, prefs, now), prefs, now, revealed, projectOrder);
}

/** One manual section: all its rows as one group, and its own date or status headings when it groups. */
export interface ManualSectionGroups<Row extends SessionGroupRow>
{
	id: string;
	/** Key `custom-<id>`, labelled with the section name, rows in the section's own sort. */
	group: SessionGroup<Row>;
	/** Upstream `v8`: headings keyed `section:<id>:<bucket>`, or null when the section lists its rows flat. */
	subgroups: SessionGroup<Row>[] | null;
}

export interface SidebarSectionGroups<Row extends SessionGroupRow>
{
	manual: ManualSectionGroups<Row>[];
	/** The Recents (Sessions) section: buildGroups over the rows no manual section holds. */
	sessions: SessionGroup<Row>[];
}

/**
 * Upstream's sections layout (`Fh`): each manual section holds the sessions assigned to it, sorted
 * by its own Sort by (its manual order first) and optionally split by Date or Status; Recents
 * groups the rest by the list's Group by. The Status and Last activity filters apply to all of it.
 */
export function buildSidebarSections<Row extends SessionGroupRow>(
	rows: readonly Row[],
	prefs: SessionListPrefs,
	now: number,
	revealed: RevealedRows,
	manual: ManualSections,
	projectOrder: readonly string[] = [],
): SidebarSectionGroups<Row>
{
	const resolved = resolveRows(rows, prefs, now);
	const known = new Set(manual.sections.map((section) => section.id));
	const sectionOf = (sessionId: string): string | undefined =>
	{
		const groupId = manual.assignments[sessionId];
		return groupId !== undefined && known.has(groupId) ? groupId : undefined;
	};
	const sessions = groupResolved(
		rows.filter((row) => sectionOf(row.sessionId) === undefined),
		{
			...resolved,
			visible: resolved.visible.filter((row) => sectionOf(row.sessionId) === undefined),
		},
		prefs,
		now,
		revealed,
		projectOrder,
	);
	const manualGroups = manual.sections.map((section): ManualSectionGroups<Row> =>
	{
		const ordered = manual.order[section.id] ?? [];
		const rank = (row: Row) =>
		{
			const index = ordered.indexOf(row.sessionId);
			return index === -1 ? ordered.length : index;
		};
		// Array.sort is stable, so rows outside the manual order keep the section's Sort by order.
		const heads = resolved.visible
			.filter((row) => sectionOf(row.sessionId) === section.id)
			.toSorted(sessionRowComparator(section.sortBy, section.sortDirection))
			.toSorted((first, second) => rank(first) - rank(second));
		const prefix = `section:${section.id}:`;
		const own =
		{
			...resolved,
			visible: heads,
		};
		return {
			id: section.id,
			group: group(customGroupKey(section.id), section.name, heads, revealed, resolved.nested),
			subgroups:
				section.groupBy === "date"
					? buildDateGroups(heads, now, revealed, resolved.nested, prefix)
					: section.groupBy === "status"
						? stateGroups(own, revealed, prefix)
						: null,
		};
	});
	return {
		manual: manualGroups,
		sessions,
	};
}

/** The header label the sidebar shows over an empty list, so its Filter control stays reachable. */
export const EMPTY_LIST_GROUP_LABELS =
{
	state: sidebarStateGroupLabels.done,
	date: "Today",
	project: "Other",
	none: "Recents",
} as const satisfies Record<SessionGroupBy, string>;

const LEGACY_GROUPING =
{
	project: "project",
	time: "date",
} as const satisfies Record<string, SessionGroupBy>;

const LEGACY_SORT =
{
	urgency: "activity",
	stable: "created",
} as const satisfies Record<string, SessionSortBy>;

function legacyValue<Value>(map: Readonly<Record<string, Value>>, raw: string | null): Value | undefined
{
	return raw !== null && Object.hasOwn(map, raw) ? map[raw] : undefined;
}

export interface StoredSessionListPrefs
{
	/** The JSON-encoded prefs, if they were ever saved. */
	stored: string | null;
	/** Legacy `ccp-sessions-grouping` value ("project" | "time"). */
	sessionsGrouping: string | null;
	/** Legacy `ccp-session-sort` value ("urgency" | "stable"). */
	sessionSort: string | null;
}

/** Custom groups mode is gone: the groups are their own sections now, so Recents goes ungrouped. */
function withoutCustomGroupBy(stored: unknown): unknown
{
	if (typeof stored !== "object" || stored === null || !("groupBy" in stored) || stored.groupBy !== "custom")
	{
		return stored;
	}
	return {
		...stored,
		groupBy: "none",
	};
}

/** Reads persisted prefs, seeding them from the legacy sessionsGrouping/sessionSort settings. */
export function migrateSessionListPrefs(input: StoredSessionListPrefs): SessionListPrefs
{
	if (input.stored !== null)
	{
		try
		{
			// Older prefs lack Show PR status, Show metadata, Sort direction or the version; default them. Unversioned
			// prefs saved Show PR status under its old default-on, so version 2 turns it off.
			const parsed = SessionListPrefsSchema.partial(
				{
					showPrStatus: true,
					showMetadata: true,
					sortDirection: true,
					version: true,
				},
			).safeParse(withoutCustomGroupBy(JSON.parse(input.stored)));
			if (parsed.success)
			{
				const migrated = parsed.data.version === undefined;
				return {
					...parsed.data,
					showPrStatus: migrated
						? DEFAULT_SESSION_LIST_PREFS.showPrStatus
						: (parsed.data.showPrStatus ?? DEFAULT_SESSION_LIST_PREFS.showPrStatus),
					showMetadata: parsed.data.showMetadata ?? DEFAULT_SESSION_LIST_PREFS.showMetadata,
					sortDirection: parsed.data.sortDirection ?? DEFAULT_SESSION_LIST_PREFS.sortDirection,
					version: DEFAULT_SESSION_LIST_PREFS.version,
				};
			}
		}
		catch
		{
			// Unparseable JSON falls through to the legacy migration.
		}
	}
	return {
		...DEFAULT_SESSION_LIST_PREFS,
		groupBy: legacyValue(LEGACY_GROUPING, input.sessionsGrouping) ?? DEFAULT_SESSION_LIST_PREFS.groupBy,
		sortBy: legacyValue(LEGACY_SORT, input.sessionSort) ?? DEFAULT_SESSION_LIST_PREFS.sortBy,
	};
}

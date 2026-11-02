import {useSyncExternalStore} from "react";
import {z} from "zod";

import {assertNever} from "./assert-never";
import
{
	SessionSortBySchema,
	SessionSortDirectionSchema,
	type SessionListPrefs,
	type SessionSortDirection,
} from "./session-groups";
import {readSessionGroupState, subscribeSessionGroups, type SessionGroupState} from "./session-group-store";

/*
 * Upstream's sidebar sections (`codeSidebarByScope[scope].sections` under the fizzy-lake `panels`
 * layout): Pinned, the user's manual sections, then Sessions ("Recents"), which always stays last.
 * Each section carries its own view. Local has no Routines (cloud scheduled tasks) and no saved
 * environments, so neither kind nor `savedEnvironment` exists here. Custom groups
 * (`ccp-session-groups`) stay the source of a manual section's name, members and appearance; this
 * store keeps the section order and each manual section's view. The Sessions view is the
 * session-list prefs (Group and sort on the Recents header), and collapse stays in the sidebar store.
 */
export const SIDEBAR_SECTIONS_STORAGE_KEY = "ccp-sidebar-sections";

export const SidebarSectionKindSchema = z.enum(["pinned", "manual", "sessions"]);
type SidebarSectionKind = z.infer<typeof SidebarSectionKindSchema>;

/** Upstream `yX` without `savedEnvironment`; a missing key means none. */
export const SectionGroupBySchema = z.enum(["none", "folder", "status", "date"]);
export type SectionGroupBy = z.infer<typeof SectionGroupBySchema>;

export const SidebarSectionSchema = z.strictObject(
	{
		id: z.string().min(1),
		kind: SidebarSectionKindSchema,
		name: z.string(),
		order: z.number().int(),
		groupBy: SectionGroupBySchema.optional(),
		sortBy: SessionSortBySchema,
		sortDirection: SessionSortDirectionSchema,
		show: z.strictObject(
			{
				metadata: z.boolean(),
				emptyGroups: z.boolean(),
			},
		),
		/** A manual section's sessions, in its manual order. */
		members: z.array(z.string()).optional(),
	},
);
export type SidebarSection = z.infer<typeof SidebarSectionSchema>;

const StoredSectionsSchema = z.strictObject(
	{
		version: z.literal(1),
		sections: z.array(SidebarSectionSchema),
	},
);

/** Upstream `ow`, less the cloud-only Show toggles. */
export const DEFAULT_SECTION_VIEW =
{
	sortBy: "activity",
	sortDirection: "desc",
	show:
	{
		metadata: false,
		emptyGroups: false,
	},
} as const satisfies Pick<SidebarSection, "sortBy" | "sortDirection" | "show">;

const PINNED_ID = "pinned";
const SESSIONS_SECTION_ID = "sessions";

function builtIn(kind: Exclude<SidebarSectionKind, "manual">, order: number): SidebarSection
{
	return {
		id: kind === "pinned" ? PINNED_ID : SESSIONS_SECTION_ID,
		kind,
		name: "",
		order,
		...DEFAULT_SECTION_VIEW,
		show:
		{
			...DEFAULT_SECTION_VIEW.show,
		},
	};
}

/** Upstream `s6` without Routines. */
export const DEFAULT_SECTIONS: readonly SidebarSection[] = Object.freeze([
	builtIn("pinned", 0),
	builtIn("sessions", 1),
]);

/**
 * Upstream `pX`: drop repeated ids, keep one Pinned and one Sessions (with their fixed ids), give each
 * session to the first manual section listing it, put Sessions last and renumber `order` from 0.
 */
export function normalizeSections(sections: readonly SidebarSection[]): SidebarSection[]
{
	const ids = new Set<string>();
	const members = new Set<string>();
	let pinned: SidebarSection | undefined;
	let sessions: SidebarSection | undefined;
	const rest: SidebarSection[] = [];
	for (const section of sections)
	{
		if (ids.has(section.id)) continue;
		ids.add(section.id);
		switch (section.kind)
		{
			case "sessions":
				sessions ??=
				{
					...section,
					id: SESSIONS_SECTION_ID,
				};
				break;
			case "pinned":
				if (pinned !== undefined) break;
				pinned =
				{
					...section,
					id: PINNED_ID,
				};
				rest.push(pinned);
				break;
			case "manual":
			{
				const own = (section.members ?? []).filter((id) =>
				{
					if (members.has(id)) return false;
					members.add(id);
					return true;
				});
				rest.push(
					{
						...section,
						members: own,
					},
				);
				break;
			}
			default:
				assertNever(section.kind);
		}
	}
	return [...rest, sessions ?? builtIn("sessions", rest.length)].map((section, order) =>
		section.order === order
			? section
			:
				{
					...section,
					order,
				},
	);
}

/** Upstream `kb`: the legacy one-list Group by as the Sessions section's grouping. */
const SECTION_GROUP_BY =
{
	project: "folder",
	state: "status",
	date: "date",
	none: "none",
	custom: "none",
} as const satisfies Record<SessionListPrefs["groupBy"] | "custom", SectionGroupBy>;

/** A custom group's sessions: its manual order first, then the rest of its assignments. */
function groupMembers(groupId: string, groups: SessionGroupState): string[]
{
	const assigned = new Set(
		Object.entries(groups.assignments).flatMap(([sessionId, id]) => (id === groupId ? [sessionId] : [])),
	);
	const ordered = (groups.order[groupId] ?? []).filter((id) => assigned.delete(id));
	return [...ordered, ...assigned];
}

function manualSection(
	group:
	{
		id: string;
		name: string;
	},
	groups: SessionGroupState,
	order: number,
): SidebarSection
{
	return {
		id: group.id,
		kind: "manual",
		name: group.name,
		order,
		...DEFAULT_SECTION_VIEW,
		show:
		{
			...DEFAULT_SECTION_VIEW.show,
		},
		members: groupMembers(group.id, groups),
	};
}

/**
 * Upstream `rI` + `kb`: Pinned, each custom group as a manual section in group order, then Sessions
 * with the old Group by (custom becomes none: the groups are their own sections now) and sort.
 */
export function migrateToSections(
	prefs: Pick<SessionListPrefs, "sortBy" | "sortDirection"> &
	{
		groupBy: SessionListPrefs["groupBy"] | "custom";
	},
	groups: SessionGroupState,
): SidebarSection[]
{
	const manual = groups.groups.map((group, index) => manualSection(group, groups, index + 1));
	return normalizeSections([
		builtIn("pinned", 0),
		...manual,
		{
			...builtIn("sessions", manual.length + 1),
			groupBy: SECTION_GROUP_BY[prefs.groupBy],
			sortBy: prefs.sortBy,
			sortDirection: prefs.sortDirection,
		},
	]);
}

/** Upstream `Rc`: move a section to `toIndex`, clamped to 0…len-2, so Sessions stays last and never moves. */
export function moveSection(sections: readonly SidebarSection[], id: string, toIndex: number): SidebarSection[]
{
	const section = sections.find((candidate) => candidate.id === id);
	if (section === undefined || section.kind === "sessions") return [...sections];
	const rest = sections.filter((candidate) => candidate.id !== id);
	const index = Math.max(0, Math.min(toIndex, sections.length - 2));
	return normalizeSections([...rest.slice(0, index), section, ...rest.slice(index)]);
}

export interface SectionViewPatch
{
	/** null clears the grouping (none). */
	groupBy?: SectionGroupBy | null;
	sortBy?: SidebarSection["sortBy"];
	sortDirection?: SessionSortDirection;
	show?: Partial<SidebarSection["show"]>;
}

/**
 * Upstream `w$`: patch one section's view. Switching between Name and another sort without a
 * direction resets the direction to descending.
 */
export function setSectionView(
	sections: readonly SidebarSection[],
	id: string,
	patch: SectionViewPatch,
): SidebarSection[]
{
	return sections.map((section) =>
	{
		if (section.id !== id) return section;
		const {groupBy: _groupBy, ...rest} = section;
		const groupBy = patch.groupBy === undefined ? section.groupBy : (patch.groupBy ?? undefined);
		const sortBy = patch.sortBy ?? section.sortBy;
		const crossesName = (sortBy === "name") !== (section.sortBy === "name");
		const sortDirection = patch.sortDirection ?? (crossesName ? "desc" : section.sortDirection);
		return {
			...rest,
			...(groupBy === undefined
				? {}
				:
					{
						groupBy,
					}),
			sortBy,
			sortDirection,
			show:
			{
				...section.show,
				...patch.show,
			},
		};
	});
}

/**
 * The stored sections brought in line with the custom groups: names and members come from the
 * groups, sections of deleted groups go, and a new group's section joins just above Sessions.
 */
function reconcile(stored: readonly SidebarSection[], groups: SessionGroupState): SidebarSection[]
{
	const byId = new Map(groups.groups.map((group) => [group.id, group]));
	const kept = stored.flatMap((section): SidebarSection[] =>
	{
		if (section.kind !== "manual") return [section];
		const group = byId.get(section.id);
		return group === undefined
			? []
			: [
					{
						...section,
						name: group.name,
						members: groupMembers(group.id, groups),
					},
				];
	});
	const known = new Set(kept.map((section) => section.id));
	const added = groups.groups.filter((group) => !known.has(group.id)).map((group) => manualSection(group, groups, 0));
	const sessionsIndex = kept.findIndex((section) => section.kind === "sessions");
	const at = sessionsIndex === -1 ? kept.length : sessionsIndex;
	return normalizeSections([...kept.slice(0, at), ...added, ...kept.slice(at)]);
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedGroups: SessionGroupState | undefined;
let cachedSections: readonly SidebarSection[] = DEFAULT_SECTIONS;

function readRaw(): string | null
{
	try
	{
		return localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
	}
	catch
	{
		return null;
	}
}

function parseStored(raw: string | null): SidebarSection[] | null
{
	if (raw === null) return null;
	try
	{
		const result = StoredSectionsSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data.sections : null;
	}
	catch
	{
		return null;
	}
}

/** This browser's sections; with nothing stored yet they are seeded from the custom groups. */
export function readSidebarSections(): readonly SidebarSection[]
{
	const raw = readRaw();
	const groups = readSessionGroupState();
	if (raw !== cachedRaw || groups !== cachedGroups)
	{
		cachedRaw = raw;
		cachedGroups = groups;
		const stored = parseStored(raw);
		cachedSections =
			stored === null
				? migrateToSections(
						{
							groupBy: "none",
							sortBy: "activity",
							sortDirection: "desc",
						},
						groups,
					)
				: reconcile(stored, groups);
	}
	return cachedSections;
}

function write(sections: readonly SidebarSection[]): void
{
	try
	{
		localStorage.setItem(
			SIDEBAR_SECTIONS_STORAGE_KEY,
			JSON.stringify(
				{
					version: 1,
					sections,
				},
			),
		);
	}
	catch
	{
		// Storage can be denied or full; sections are best-effort per browser.
	}
	for (const listener of listeners) listener();
}

/** Upstream `moveSection`; see moveSection. */
export function moveSidebarSection(id: string, toIndex: number): void
{
	write(moveSection(readSidebarSections(), id, toIndex));
}

/** Upstream `setSectionView`; see setSectionView. */
export function setSidebarSectionView(id: string, patch: SectionViewPatch): void
{
	write(setSectionView(readSidebarSections(), id, patch));
}

/** Upstream `zC` Sort A to Z: the manual sections by name, in the places manual sections hold. */
export function sortManualSectionsByName(): void
{
	const sections = readSidebarSections();
	const sorted = sections
		.filter((section) => section.kind === "manual")
		.toSorted((first, second) =>
			first.name.localeCompare(
				second.name,
				undefined,
				{
					sensitivity: "base",
				},
			),
		);
	let next = 0;
	write(
		normalizeSections(
			sections.map((section) =>
			{
				if (section.kind !== "manual") return section;
				const replacement = sorted[next] ?? section;
				next += 1;
				return replacement;
			}),
		),
	);
}

function onStorage(event: StorageEvent): void
{
	if (event.key === null || event.key === SIDEBAR_SECTIONS_STORAGE_KEY)
	{
		for (const listener of listeners) listener();
	}
}

function subscribe(listener: () => void): () => void
{
	if (listeners.size === 0) globalThis.addEventListener("storage", onStorage);
	listeners.add(listener);
	const unsubscribeGroups = subscribeSessionGroups(listener);
	return () =>
	{
		unsubscribeGroups();
		listeners.delete(listener);
		if (listeners.size === 0) globalThis.removeEventListener("storage", onStorage);
	};
}

function getServerSnapshot(): readonly SidebarSection[]
{
	return DEFAULT_SECTIONS;
}

/** Live sections for this browser, following the custom groups and other tabs. */
export function useSidebarSections(): readonly SidebarSection[]
{
	return useSyncExternalStore(subscribe, readSidebarSections, getServerSnapshot);
}

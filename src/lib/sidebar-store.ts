import {useSyncExternalStore} from "react";
import {z} from "zod";

import {useShortcut} from "../hooks/use-shortcut";
import {narrowViewportQuery, PHONE_SHEET_QUERY, useMediaQuery} from "./use-phone-sheet";

export const SIDEBAR_STORAGE_KEY = "ccb-sidebar";

export const SIDEBAR_MIN_WIDTH = 232;
export const SIDEBAR_MAX_WIDTH = 420;

const SidebarStateSchema = z.strictObject(
	{
		collapsed: z.boolean(),
		width: z.number().int().min(SIDEBAR_MIN_WIDTH).max(SIDEBAR_MAX_WIDTH),
		collapsedGroups: z.array(z.string()),
		/** Collapsed fork families, keyed like upstream's `collapsedFamilies`: `code:<headSessionId>`. */
		collapsedFamilies: z.array(z.string()).default([]),
		/** How many Recents rows the list last showed (upstream `sidebarRowCountsByScope[…]["code.recents"]`). */
		recentsRowCount: z.number().int().optional(),
	},
);

export type SidebarState = z.infer<typeof SidebarStateSchema>;

export const DEFAULT_SIDEBAR_STATE: SidebarState =
{
	collapsed: false,
	width: 288,
	collapsedGroups: [],
	collapsedFamilies: [],
};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: SidebarState = DEFAULT_SIDEBAR_STATE;

function readRaw(): string | null
{
	try
	{
		return window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
	}
	catch
	{
		return null;
	}
}

function parse(raw: string | null): SidebarState
{
	if (raw === null) return DEFAULT_SIDEBAR_STATE;
	try
	{
		const result = SidebarStateSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : DEFAULT_SIDEBAR_STATE;
	}
	catch
	{
		return DEFAULT_SIDEBAR_STATE;
	}
}

/** Current persisted sidebar state; corrupt or unreadable storage yields defaults. */
export function readSidebarState(): SidebarState
{
	const raw = readRaw();
	if (raw !== cachedRaw)
	{
		cachedRaw = raw;
		cachedState = parse(raw);
	}
	return cachedState;
}

export function writeSidebarState(state: SidebarState): void
{
	try
	{
		window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
	}
	catch
	{
		// Storage can be denied or full; the sidebar keeps working with its in-memory render.
	}
	for (const listener of listeners) listener();
}

export function toggleSidebarCollapsed(): void
{
	const state = readSidebarState();
	writeSidebarState(
		{
			...state,
			collapsed: !state.collapsed,
		},
	);
}

const peekToggleListeners = new Set<() => void>();

/** Subscribe the collapsed sidebar to peek toggles from ⌘B and the command palette. */
export function onPeekToggle(listener: () => void): () => void
{
	peekToggleListeners.add(listener);
	return () => peekToggleListeners.delete(listener);
}

function matches(query: string): boolean
{
	return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Upstream's `toggleCollapsed`: in the narrow forced-collapse band (640px up to the width-aware
 * `narrowViewportQuery`) it toggles the hover
 * peek and leaves the persisted preference alone; elsewhere it flips `collapsed`.
 */
export function toggleSidebar(): void
{
	if (
		peekToggleListeners.size > 0 &&
		matches(narrowViewportQuery(readSidebarState().width)) &&
		!matches(PHONE_SHEET_QUERY)
	)
	{
		for (const listener of peekToggleListeners) listener();
		return;
	}
	toggleSidebarCollapsed();
}

let peekSuppressedUntilLeave = false;

/**
 * Upstream's `peekSuppressedUntilLeave` (`Gm`): a mouse click on Hide sidebar leaves the pointer over the
 * collapsed trigger, which must not hover-open the peek (or its tooltip) until the pointer leaves it.
 */
export function suppressPeekUntilLeave(): void
{
	peekSuppressedUntilLeave = true;
}

export function isPeekSuppressed(): boolean
{
	return peekSuppressedUntilLeave;
}

export function clearPeekSuppression(): void
{
	peekSuppressedUntilLeave = false;
}

export function setSidebarWidth(width: number): void
{
	writeSidebarState(
		{
			...readSidebarState(),
			width,
		},
	);
}

/** Collapse or expand one session-list group, keyed like upstream's `collapsedGroups`. */
export function toggleSidebarGroup(key: string): void
{
	const state = readSidebarState();
	const collapsedGroups = state.collapsedGroups.includes(key)
		? state.collapsedGroups.filter((collapsed) => collapsed !== key)
		: [...state.collapsedGroups, key];
	writeSidebarState(
		{
			...state,
			collapsedGroups,
		},
	);
}

/** Expand one session-list group (upstream's `expandGroup`); a no-op when it is already expanded. */
export function expandSidebarGroup(key: string): void
{
	const state = readSidebarState();
	if (!state.collapsedGroups.includes(key)) return;
	writeSidebarState(
		{
			...state,
			collapsedGroups: state.collapsedGroups.filter((collapsed) => collapsed !== key),
		},
	);
}

/** Collapse or expand several session-list groups at once (upstream's header Collapse all / Expand all). */
export function setSidebarGroupsCollapsed(keys: readonly string[], collapsed: boolean): void
{
	const state = readSidebarState();
	const targets = new Set(keys);
	const collapsedGroups = collapsed
		? [...new Set([...state.collapsedGroups, ...targets])]
		: state.collapsedGroups.filter((key) => !targets.has(key));
	writeSidebarState(
		{
			...state,
			collapsedGroups,
		},
	);
}

export function familyKey(headSessionId: string): string
{
	return `code:${headSessionId}`;
}

/** Collapse or expand one fork family's nested sessions. */
export function toggleFamilyCollapsed(headSessionId: string): void
{
	const state = readSidebarState();
	const key = familyKey(headSessionId);
	const collapsedFamilies = state.collapsedFamilies.includes(key)
		? state.collapsedFamilies.filter((collapsed) => collapsed !== key)
		: [...state.collapsedFamilies, key];
	writeSidebarState(
		{
			...state,
			collapsedFamilies,
		},
	);
}

/** Collapse or expand several fork families at once (upstream `wI`; ⌘K Hide all nested sessions). */
export function setFamiliesCollapsed(headSessionIds: readonly string[], collapsed: boolean): void
{
	const state = readSidebarState();
	const keys = new Set(headSessionIds.map(familyKey));
	const collapsedFamilies = collapsed
		? [...new Set([...state.collapsedFamilies, ...keys])]
		: state.collapsedFamilies.filter((key) => !keys.has(key));
	writeSidebarState(
		{
			...state,
			collapsedFamilies,
		},
	);
}

/** Expand every fork family, stale keys included (upstream `wI(false)`; ⌘K Show all nested sessions). */
export function showAllNestedSessions(): void
{
	writeSidebarState(
		{
			...readSidebarState(),
			collapsedFamilies: [],
		},
	);
}

/** Upstream `m4.recents` with a section view: the code list's placeholder holds at most 21 rows. */
const RECENTS_ROW_CAP = 21;
/** Upstream `Fg`: a remembered count settles for 2s before it is written. */
const ROW_COUNT_WRITE_MS = 2000;
/** Upstream `PA`: a count that shrinks is written after 250ms, so a reload never reserves rows that are gone. */
const ROW_COUNT_SHRINK_WRITE_MS = 250;

let pendingRowCount: ReturnType<typeof setTimeout> | undefined;

/** Upstream `recordSidebarRowCount(scope, "code.recents", n)`: remember how many Recents rows the list shows. */
export function recordRecentsRowCount(count: number): void
{
	cancelPendingRecentsRowCount();
	const stored = readSidebarState().recentsRowCount;
	if (stored === count) return;
	pendingRowCount = setTimeout(
		() =>
		{
			pendingRowCount = undefined;
			writeSidebarState(
				{
					...readSidebarState(),
					recentsRowCount: count,
				},
			);
		},
		stored !== undefined && count < stored ? ROW_COUNT_SHRINK_WRITE_MS : ROW_COUNT_WRITE_MS,
	);
}

/** Drop a Recents count still waiting to be written, as leaving the page would. */
export function cancelPendingRecentsRowCount(): void
{
	clearTimeout(pendingRowCount);
	pendingRowCount = undefined;
}

/** Whether a Recents count is still waiting to be written; the client perf lab fails on one left on the real clock. */
export function hasPendingRecentsRowCount(): boolean
{
	return pendingRowCount !== undefined;
}

/** Upstream `Xw`: the remembered Recents row count clamped to 0…21, or undefined when none is stored. */
export function rememberedRecentsRows(): number | undefined
{
	const stored = readSidebarState().recentsRowCount;
	return stored === undefined ? undefined : Math.min(Math.max(0, stored), RECENTS_ROW_CAP);
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getServerSnapshot(): SidebarState
{
	return DEFAULT_SIDEBAR_STATE;
}

export function useSidebarState(): SidebarState
{
	return useSyncExternalStore(subscribe, readSidebarState, getServerSnapshot);
}

/** Bind ⌘B / Ctrl+B to the sidebar toggle, including while a text field has focus. */
export function useSidebarToggleShortcut(): void
{
	useShortcut(
		"toggle_sidebar",
		() =>
		{
			toggleSidebar();
		},
		{
			allowInEditable: true,
		},
	);
}

/**
 * Upstream's `isNarrowViewport`: true at or below `narrowViewportQuery(sidebarWidth)`, where the sidebar
 * renders collapsed with hover peek. Lives here, not in use-phone-sheet, because it reads the stored width.
 */
export function useNarrowViewport(): boolean
{
	return useMediaQuery(narrowViewportQuery(useSidebarState().width));
}

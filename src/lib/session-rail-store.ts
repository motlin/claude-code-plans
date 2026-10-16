import {useSyncExternalStore} from "react";
import {z} from "zod";

/** Upstream's `persisted.epitaxy.sessionRailShown`, under our own key: one global shown flag. */
export const SESSION_RAIL_STORAGE_KEY = "ccb-session-rail";

/** Upstream's `epitaxy.sessionRailSections`, under our own key: folds per session, plus hidden and order. */
export const RAIL_SECTIONS_STORAGE_KEY = "ccb-session-rail-sections";

/** Upstream's card ids, in its default order. */
const RAIL_SECTION_IDS = [
	"environment",
	"goal",
	"settings",
	"context",
	"usage",
	"connectors",
	"progress",
	"outputs",
	"pullRequests",
	"servers",
	"backgroundTasks",
] as const;

export const RailSectionIdSchema = z.enum(RAIL_SECTION_IDS);
export type RailSectionId = z.infer<typeof RailSectionIdSchema>;

/** Upstream's card titles. */
export const RAIL_SECTION_TITLES = {
	environment: "Environment",
	goal: "Goal",
	settings: "Settings",
	context: "Context",
	usage: "Usage",
	connectors: "Connectors",
	progress: "Progress",
	outputs: "Outputs",
	pullRequests: "Changes",
	servers: "Servers",
	backgroundTasks: "Background tasks",
} satisfies Record<RailSectionId, string>;

const RailShownStoredSchema = z.strictObject({
	state: z.strictObject({shown: z.boolean()}),
	version: z.literal(1),
});

const RailFoldsSchema = z.strictObject({
	collapsed: z.array(RailSectionIdSchema),
	expanded: z.array(RailSectionIdSchema),
});

const RailSectionsStateSchema = z.strictObject({
	foldsBySession: z.record(z.string(), RailFoldsSchema),
	startsOpen: z.partialRecord(RailSectionIdSchema, z.boolean()),
	hidden: z.array(RailSectionIdSchema),
	order: z.array(RailSectionIdSchema),
});

const RailSectionsStoredSchema = z.strictObject({
	state: RailSectionsStateSchema,
	version: z.literal(0),
});

export type RailSectionsState = z.infer<typeof RailSectionsStateSchema>;

export const DEFAULT_RAIL_SECTIONS_STATE: RailSectionsState = {
	foldsBySession: {},
	startsOpen: {environment: true, context: true},
	hidden: [],
	order: [],
};

/** A tiny localStorage-backed store: corrupt, foreign or unreadable storage yields the fallback. */
function createStore<T>(key: string, parse: (value: unknown) => T | null, fallback: T, wrap: (state: T) => unknown) {
	const listeners = new Set<() => void>();
	let cachedRaw: string | null | undefined;
	let cached = fallback;

	function read(): T {
		let raw: string | null;
		try {
			raw = window.localStorage.getItem(key);
		} catch {
			raw = null;
		}
		if (raw !== cachedRaw) {
			cachedRaw = raw;
			try {
				cached = raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
			} catch {
				cached = fallback;
			}
		}
		return cached;
	}

	function write(state: T): void {
		try {
			window.localStorage.setItem(key, JSON.stringify(wrap(state)));
		} catch {
			// Storage can be denied or full; the rail keeps working for this render.
		}
		for (const listener of listeners) listener();
	}

	function subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function useValue(): T {
		return useSyncExternalStore(subscribe, read, () => fallback);
	}

	return {read, write, useValue};
}

const shownStore = createStore(
	SESSION_RAIL_STORAGE_KEY,
	(value) => {
		const result = RailShownStoredSchema.safeParse(value);
		return result.success ? result.data.state.shown : null;
	},
	false,
	(shown) => ({state: {shown}, version: 1}),
);

const sectionsStore = createStore(
	RAIL_SECTIONS_STORAGE_KEY,
	(value) => {
		const result = RailSectionsStoredSchema.safeParse(value);
		return result.success ? result.data.state : null;
	},
	DEFAULT_RAIL_SECTIONS_STATE,
	(state) => ({state, version: 0}),
);

export const readSessionRailShown = shownStore.read;
export const useSessionRailShown = shownStore.useValue;

export function setSessionRailShown(shown: boolean): void {
	shownStore.write(shown);
}

export const readRailSectionsState = sectionsStore.read;
export const useRailSectionsState = sectionsStore.useValue;

function startsOpen(state: RailSectionsState, id: RailSectionId): boolean {
	return state.startsOpen[id] ?? false;
}

export function isRailSectionOpen(state: RailSectionsState, sessionId: string, id: RailSectionId): boolean {
	const folds = state.foldsBySession[sessionId];
	if (folds?.expanded.includes(id) === true) return true;
	if (folds?.collapsed.includes(id) === true) return false;
	return startsOpen(state, id);
}

/** Folds `ids` to `open` in one session; a card back at its default leaves both lists. */
function withOpen(
	state: RailSectionsState,
	sessionId: string,
	ids: readonly RailSectionId[],
	open: boolean,
): RailSectionsState {
	const folds = state.foldsBySession[sessionId] ?? {collapsed: [], expanded: []};
	const touched = new Set(ids);
	const collapsed = folds.collapsed.filter((id) => !touched.has(id));
	const expanded = folds.expanded.filter((id) => !touched.has(id));
	for (const id of ids) {
		if (open === startsOpen(state, id)) continue;
		(open ? expanded : collapsed).push(id);
	}
	return {...state, foldsBySession: {...state.foldsBySession, [sessionId]: {collapsed, expanded}}};
}

export function toggleRailSection(sessionId: string, id: RailSectionId): void {
	const state = readRailSectionsState();
	sectionsStore.write(withOpen(state, sessionId, [id], !isRailSectionOpen(state, sessionId, id)));
}

/** Upstream's Alt-click on a card header: every card takes that card's new state. */
export function setRailSectionsOpen(sessionId: string, ids: readonly RailSectionId[], open: boolean): void {
	sectionsStore.write(withOpen(readRailSectionsState(), sessionId, ids, open));
}

/** The sections upstream's header menu lists under Show; Environment, Settings, Usage and Progress always show. */
export const HIDEABLE_RAIL_SECTIONS = [
	"goal",
	"context",
	"connectors",
	"outputs",
	"pullRequests",
	"servers",
	"backgroundTasks",
] as const satisfies readonly RailSectionId[];

export function toggleRailSectionHidden(id: RailSectionId): void {
	const state = readRailSectionsState();
	const hidden = state.hidden.includes(id) ? state.hidden.filter((each) => each !== id) : [...state.hidden, id];
	sectionsStore.write({...state, hidden});
}

/** Whether Reset to defaults has anything to undo: hidden sections, a custom order or a changed fold. */
export function isRailSectionsPristine(state: RailSectionsState): boolean {
	return (
		state.hidden.length === 0 &&
		state.order.length === 0 &&
		Object.values(state.foldsBySession).every(
			(folds) => folds.collapsed.length === 0 && folds.expanded.length === 0,
		)
	);
}

/** Upstream's Reset to defaults: order, hidden sections and every session's folds. */
export function resetRailSections(): void {
	sectionsStore.write(DEFAULT_RAIL_SECTIONS_STATE);
}

/** `ids` in the saved order; cards it does not name keep their default order after the named ones. */
export function orderRailSections<T extends RailSectionId>(ids: readonly T[], order: readonly RailSectionId[]): T[] {
	const rank = (id: T) => {
		const saved = order.indexOf(id);
		return saved === -1 ? order.length + ids.indexOf(id) : saved;
	};
	return ids.toSorted((a, b) => rank(a) - rank(b));
}

/**
 * Upstream's drop: `active` takes `over`'s place among the shown cards, and the
 * new sequence fills the shown cards' slots in the saved order, so hidden or
 * empty sections keep theirs.
 */
export function reorderRailSections(shown: readonly RailSectionId[], active: RailSectionId, over: RailSectionId): void {
	const from = shown.indexOf(active);
	const to = shown.indexOf(over);
	if (from === -1 || to === -1 || from === to) return;
	const moved = [...shown];
	moved.splice(to, 0, ...moved.splice(from, 1));
	const state = readRailSectionsState();
	const shownSet = new Set(shown);
	const queue = [...moved];
	const order = state.order.map((id) => (shownSet.has(id) ? (queue.shift() ?? id) : id));
	sectionsStore.write({...state, order: [...order, ...queue]});
}

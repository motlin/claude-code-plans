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
	startsOpen: {},
	hidden: [],
	order: [],
};

/** Upstream's `ri`: the cards that start collapsed until a hand toggle changes their default. */
const CLOSED_BY_DEFAULT: ReadonlySet<RailSectionId> = new Set(["connectors", "context", "usage"]);

/** Upstream's `ci`: folds are kept for this many sessions, newest last. */
const MAX_FOLDED_SESSIONS = 100;

function defaultOpen(id: RailSectionId): boolean {
	return !CLOSED_BY_DEFAULT.has(id);
}

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
	return state.startsOpen[id] ?? defaultOpen(id);
}

export function isRailSectionOpen(state: RailSectionsState, sessionId: string, id: RailSectionId): boolean {
	const folds = state.foldsBySession[sessionId];
	if (folds?.expanded.includes(id) === true) return true;
	if (folds?.collapsed.includes(id) === true) return false;
	return startsOpen(state, id);
}

type RailFolds = RailSectionsState["foldsBySession"][string];

/** Upstream's `fi`: the session moves to the newest slot, empty folds leave, and only the newest 100 sessions stay. */
function withSessionFolds(
	foldsBySession: RailSectionsState["foldsBySession"],
	sessionId: string,
	folds: RailFolds | undefined,
): RailSectionsState["foldsBySession"] {
	const {[sessionId]: _replaced, ...rest} = foldsBySession;
	if (folds === undefined || (folds.collapsed.length === 0 && folds.expanded.length === 0)) return rest;
	const entries = Object.entries({...rest, [sessionId]: folds});
	return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_FOLDED_SESSIONS)));
}

/** Upstream's `pi`: each of `ids` is recorded as explicitly open or collapsed in one session. */
function withOpen(
	state: RailSectionsState,
	sessionId: string,
	ids: readonly RailSectionId[],
	open: boolean,
): RailSectionsState["foldsBySession"] {
	const folds = state.foldsBySession[sessionId] ?? {collapsed: [], expanded: []};
	const touched = new Set(ids);
	const collapsed = folds.collapsed.filter((id) => !touched.has(id));
	const expanded = folds.expanded.filter((id) => !touched.has(id));
	(open ? expanded : collapsed).push(...ids);
	return withSessionFolds(state.foldsBySession, sessionId, {collapsed, expanded});
}

/** Upstream's `setOpenByHand`: the session's fold, which also becomes the card's default for unfolded sessions. */
export function toggleRailSection(sessionId: string, id: RailSectionId): void {
	const state = readRailSectionsState();
	const open = !isRailSectionOpen(state, sessionId, id);
	sectionsStore.write({
		...state,
		foldsBySession: withOpen(state, sessionId, [id], open),
		startsOpen: {...state.startsOpen, [id]: open},
	});
}

/** Upstream's Alt-click on a card header: every card takes that card's new state. */
export function setRailSectionsOpen(sessionId: string, ids: readonly RailSectionId[], open: boolean): void {
	const state = readRailSectionsState();
	sectionsStore.write({...state, foldsBySession: withOpen(state, sessionId, ids, open)});
}

/** The sections upstream's header menu lists under Show; Environment always shows; the session rail never builds Settings (the composer chin has mode and effort), Usage (the composer ring popover and usage band have the limits) or Progress (the Plan pane has the checklist). */
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

/** Upstream's `Di`: whether Reset to defaults has nothing to undo in this session. */
export function isRailSectionsPristine(state: RailSectionsState, sessionId: string): boolean {
	return (
		state.hidden.length === 0 &&
		orderRailSections(RAIL_SECTION_IDS, state.order).every((id, index) => RAIL_SECTION_IDS[index] === id) &&
		RAIL_SECTION_IDS.every(
			(id) =>
				state.startsOpen[id] !== !defaultOpen(id) &&
				isRailSectionOpen(state, sessionId, id) === defaultOpen(id),
		)
	);
}

/** Upstream's `resetSections`: hidden sections, order, defaults and this session's folds. */
export function resetRailSections(sessionId: string): void {
	const state = readRailSectionsState();
	sectionsStore.write({
		...DEFAULT_RAIL_SECTIONS_STATE,
		foldsBySession: withSessionFolds(state.foldsBySession, sessionId, undefined),
	});
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

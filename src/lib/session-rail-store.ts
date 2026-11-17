import {useSyncExternalStore} from "react";
import {z} from "zod";

/** Upstream's `persisted.epitaxy.sessionRailShown`, under our own key: one global shown flag. */
export const SESSION_RAIL_STORAGE_KEY = "ccb-session-rail";

/** Upstream's `epitaxy.sessionRailSections`, under our own key: folds per session, plus hidden and order. */
export const RAIL_SECTIONS_STORAGE_KEY = "ccb-session-rail-sections";

/** Upstream's card ids, in its default order. Upstream also has `flask` (an internal-gated opaque module, `__gb__428353835` / `cai_keen_flask`, anchored before connectors, collapsed by default); it has no local source. */
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
export const RAIL_SECTION_TITLES =
{
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

const RailShownStoredSchema = z.strictObject(
	{
		state: z.strictObject(
			{
				shown: z.boolean(),
			},
		),
		version: z.literal(1),
	},
);

const RailFoldsSchema = z.strictObject(
	{
		collapsed: z.array(RailSectionIdSchema),
		expanded: z.array(RailSectionIdSchema),
	},
);

const RailSectionsStateSchema = z.strictObject(
	{
		foldsBySession: z.record(z.string(), RailFoldsSchema),
		startsOpen: z.partialRecord(RailSectionIdSchema, z.boolean()),
		hidden: z.array(RailSectionIdSchema),
		order: z.array(RailSectionIdSchema),
	},
);

const RailSectionsStoredSchema = z.strictObject(
	{
		state: RailSectionsStateSchema,
		version: z.literal(0),
	},
);

export type RailSectionsState = z.infer<typeof RailSectionsStateSchema>;

export const DEFAULT_RAIL_SECTIONS_STATE: RailSectionsState =
{
	foldsBySession: {},
	startsOpen: {},
	hidden: [],
	order: [],
};

/** Upstream's `ri`: the cards that start collapsed until a hand toggle changes their default. */
const CLOSED_BY_DEFAULT: ReadonlySet<RailSectionId> = new Set(["connectors", "context", "usage"]);

/** Upstream's `ci`: folds are kept for this many sessions, newest last. */
const MAX_FOLDED_SESSIONS = 100;

function defaultOpen(id: RailSectionId): boolean
{
	return !CLOSED_BY_DEFAULT.has(id);
}

/** A tiny localStorage-backed store: corrupt, foreign or unreadable storage yields the fallback. */
function createStore<T>(key: string, parse: (value: unknown) => T | null, fallback: T, wrap: (state: T) => unknown)
{
	const listeners = new Set<() => void>();
	let cachedRaw: string | null | undefined;
	let cached = fallback;

	function read(): T
	{
		let raw: string | null;
		try
		{
			raw = window.localStorage.getItem(key);
		}
		catch
		{
			raw = null;
		}
		if (raw !== cachedRaw)
		{
			cachedRaw = raw;
			try
			{
				cached = raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
			}
			catch
			{
				cached = fallback;
			}
		}
		return cached;
	}

	function write(state: T): void
	{
		try
		{
			window.localStorage.setItem(key, JSON.stringify(wrap(state)));
		}
		catch
		{
			// Storage can be denied or full; the rail keeps working for this render.
		}
		for (const listener of listeners) listener();
	}

	function subscribe(listener: () => void): () => void
	{
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function useValue(): T
	{
		return useSyncExternalStore(subscribe, read, () => fallback);
	}

	return {
		read,
		write,
		useValue,
	};
}

const shownStore = createStore(
	SESSION_RAIL_STORAGE_KEY,
	(value) =>
	{
		const result = RailShownStoredSchema.safeParse(value);
		return result.success ? result.data.state.shown : null;
	},
	false,
	(shown) => (
	{
		state:
		{
			shown,
		},
		version: 1,
	}),
);

const sectionsStore = createStore(
	RAIL_SECTIONS_STORAGE_KEY,
	(value) =>
	{
		const result = RailSectionsStoredSchema.safeParse(value);
		return result.success ? result.data.state : null;
	},
	DEFAULT_RAIL_SECTIONS_STATE,
	(state) => (
	{
		state,
		version: 0,
	}),
);

export const readSessionRailShown = shownStore.read;
export const useSessionRailShown = shownStore.useValue;

export function setSessionRailShown(shown: boolean): void
{
	shownStore.write(shown);
}

export const readRailSectionsState = sectionsStore.read;
export const useRailSectionsState = sectionsStore.useValue;

function startsOpen(state: RailSectionsState, id: RailSectionId): boolean
{
	return state.startsOpen[id] ?? defaultOpen(id);
}

export function isRailSectionOpen(state: RailSectionsState, sessionId: string, id: RailSectionId): boolean
{
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
): RailSectionsState["foldsBySession"]
{
	const {[sessionId]: _replaced, ...rest} = foldsBySession;
	if (folds === undefined || (folds.collapsed.length === 0 && folds.expanded.length === 0)) return rest;
	const entries = Object.entries(
		{
			...rest,
			[sessionId]: folds,
		},
	);
	return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_FOLDED_SESSIONS)));
}

/** Upstream's `pi`: each of `ids` is recorded as explicitly open or collapsed in one session. */
function withOpen(
	state: RailSectionsState,
	sessionId: string,
	ids: readonly RailSectionId[],
	open: boolean,
): RailSectionsState["foldsBySession"]
{
	const folds = state.foldsBySession[sessionId] ??
	{
		collapsed: [],
		expanded: [],
	};
	const touched = new Set(ids);
	const collapsed = folds.collapsed.filter((id) => !touched.has(id));
	const expanded = folds.expanded.filter((id) => !touched.has(id));
	(open ? expanded : collapsed).push(...ids);
	return withSessionFolds(
		state.foldsBySession,
		sessionId,
		{
			collapsed,
			expanded,
		},
	);
}

/** Upstream's `setOpenByHand`: the session's fold, which also becomes the card's default for unfolded sessions. */
export function toggleRailSection(sessionId: string, id: RailSectionId): void
{
	const state = readRailSectionsState();
	const open = !isRailSectionOpen(state, sessionId, id);
	sectionsStore.write(
		{
			...state,
			foldsBySession: withOpen(state, sessionId, [id], open),
			startsOpen:
			{
				...state.startsOpen,
				[id]: open,
			},
		},
	);
}

/** Upstream's Alt-click on a card header: every card takes that card's new state. */
export function setRailSectionsOpen(sessionId: string, ids: readonly RailSectionId[], open: boolean): void
{
	const state = readRailSectionsState();
	sectionsStore.write(
		{
			...state,
			foldsBySession: withOpen(state, sessionId, ids, open),
		},
	);
}

/** A command's ask for one session's rail on screen; `seq` tells repeated asks apart. */
export interface RailRaiseRequest
{
	sessionId: string;
	seq: number;
}

let railRaiseRequest: RailRaiseRequest | null = null;
const raiseListeners = new Set<() => void>();

/** The latest raise request (in memory, never persisted). */
export function readRailRaiseRequest(): RailRaiseRequest | null
{
	return railRaiseRequest;
}

function subscribeRailRaiseRequest(listener: () => void): () => void
{
	raiseListeners.add(listener);
	return () => raiseListeners.delete(listener);
}

/** The latest raise request; a new one means that session's rail should come on screen if it isn't. */
export function useRailRaiseRequest(): RailRaiseRequest | null
{
	return useSyncExternalStore(subscribeRailRaiseRequest, readRailRaiseRequest, () => null);
}

/**
 * Upstream's `openComposerMenu("context")`, as its consumers take it: the rail Context card
 * opens through `setOpen` (only this session's fold changes, never `startsOpen`), and the
 * rail is asked to come on screen (`yq` raises it as an overlay when hidden or off screen).
 * A hidden Context card still records the fold; nothing card-specific shows.
 */
export function requestRailContextCard(sessionId: string): void
{
	setRailSectionsOpen(sessionId, ["context"], true);
	railRaiseRequest =
	{
		sessionId,
		seq: (railRaiseRequest?.seq ?? 0) + 1,
	};
	for (const listener of raiseListeners) listener();
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

export function toggleRailSectionHidden(id: RailSectionId): void
{
	const state = readRailSectionsState();
	const hidden = state.hidden.includes(id) ? state.hidden.filter((each) => each !== id) : [...state.hidden, id];
	sectionsStore.write(
		{
			...state,
			hidden,
		},
	);
}

/** Upstream's `Di`: whether Reset to defaults has nothing to undo in this session. */
export function isRailSectionsPristine(state: RailSectionsState, sessionId: string): boolean
{
	return (
		state.hidden.length === 0 &&
		mergeRailSectionOrder(state.order).every((id, index) => RAIL_SECTION_IDS[index] === id) &&
		RAIL_SECTION_IDS.every(
			(id) =>
				state.startsOpen[id] !== !defaultOpen(id) &&
				isRailSectionOpen(state, sessionId, id) === defaultOpen(id),
		)
	);
}

/** Upstream's `resetSections`: hidden sections, order, defaults and this session's folds. */
export function resetRailSections(sessionId: string): void
{
	const state = readRailSectionsState();
	sectionsStore.write(
		{
			...DEFAULT_RAIL_SECTIONS_STATE,
			foldsBySession: withSessionFolds(state.foldsBySession, sessionId, undefined),
		},
	);
}

/** Upstream's `q`: ids added after orders were first saved, placed just before their anchor in an order that lacks them. */
const RAIL_SECTION_ANCHORS: Partial<Record<RailSectionId, RailSectionId>> =
{
	servers: "backgroundTasks",
};

/** Upstream's `J`: the saved ids fill the default slots they name, unsaved ids keep their default slot, and anchored ids sit before their anchor. */
function mergeRailSectionOrder(order: readonly RailSectionId[]): RailSectionId[]
{
	const anchored = RAIL_SECTION_IDS.flatMap((id) =>
	{
		const before = RAIL_SECTION_ANCHORS[id];
		return before !== undefined && !order.includes(id) && order.includes(before)
			? [
					{
						id,
						before,
					},
				]
			: [];
	});
	const queue = [...order];
	const merged = RAIL_SECTION_IDS.filter((id) => !anchored.some((each) => each.id === id)).map((id) =>
		order.includes(id) ? (queue.shift() ?? id) : id,
	);
	for (const {id, before} of anchored) merged.splice(merged.indexOf(before), 0, id);
	return merged;
}

/** `ids` in upstream's merged order. */
export function orderRailSections<T extends RailSectionId>(ids: readonly T[], order: readonly RailSectionId[]): T[]
{
	return mergeRailSectionOrder(order).filter((id): id is T => (ids as readonly RailSectionId[]).includes(id));
}

/** Upstream's drop: `active` takes `over`'s slot, and every section's slot is saved, so hidden or empty sections keep theirs. */
export function reorderRailSections(active: RailSectionId, over: RailSectionId): void
{
	const state = readRailSectionsState();
	const order = mergeRailSectionOrder(state.order);
	const from = order.indexOf(active);
	const to = order.indexOf(over);
	if (from === -1 || to === -1 || from === to) return;
	order.splice(to, 0, ...order.splice(from, 1));
	sectionsStore.write(
		{
			...state,
			order,
		},
	);
}

/** Upstream's `epitaxy.sidePaneStore.v1` `bandHeightsBySession`, under our own key: remembered rail band heights per session. */
export const RAIL_BAND_HEIGHTS_STORAGE_KEY = "ccb-session-rail-band-heights";

/** Upstream's `Pha` cap on a remembered first-card height. */
const FIRST_CARD_MAX_PX = 360;
/** Below this the skeleton's first card is too short for its two rows, so they drop (upstream `Pha`). */
const FIRST_CARD_ROWS_MIN_PX = 86;
/** Upstream's `nF`: a first card's height is recorded once it has held still this long. */
export const FIRST_CARD_RECORD_DEBOUNCE_MS = 1000;

const FIRST_CARD_KEY_PREFIX = "session-rail-first-card:";

const BandHeightsSchema = z.record(
	z.string(),
	z.record(
		z.string(),
		z.strictObject(
			{
				px: z.number(),
			},
		),
	),
);

type BandHeights = z.infer<typeof BandHeightsSchema>;

const BandHeightsStoredSchema = z.strictObject(
	{
		state: z.strictObject(
			{
				bandHeightsBySession: BandHeightsSchema,
			},
		),
		version: z.literal(0),
	},
);

const bandHeightsStore = createStore<BandHeights>(
	RAIL_BAND_HEIGHTS_STORAGE_KEY,
	(value) =>
	{
		const result = BandHeightsStoredSchema.safeParse(value);
		return result.success ? result.data.state.bandHeightsBySession : null;
	},
	{},
	(bandHeightsBySession) => (
	{
		state:
		{
			bandHeightsBySession,
		},
		version: 0,
	}),
);

export const readRailBandHeights = bandHeightsStore.read;

/** Upstream's `EL`: the first card's height is remembered per rail config, so a changed config starts from the default. */
export function railFirstCardKey(state: RailSectionsState, sessionId: string): string
{
	return (
		FIRST_CARD_KEY_PREFIX +
		JSON.stringify([state.order, state.hidden, state.startsOpen, state.foldsBySession[sessionId] ?? null])
	);
}

/** Upstream's `tF`: the rounded height replaces the session's other first-card entries; heights at or below 0 are dropped. */
export function recordRailFirstCardHeight(sessionId: string, key: string, height: number): void
{
	const px = Math.round(height);
	if (!(px > 0)) return;
	const all = readRailBandHeights();
	const {[sessionId]: bands = {}, ...rest} = all;
	const kept = Object.entries(bands).filter(([each]) => !each.startsWith(FIRST_CARD_KEY_PREFIX));
	const entries = Object.entries(
		{
			...rest,
			[sessionId]: Object.fromEntries([
				...kept,
				[
					key,
					{
						px,
					},
				],
			]),
		},
	);
	bandHeightsStore.write(Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_FOLDED_SESSIONS))));
}

/** Upstream's `Pha`: the skeleton's first-card vars for a remembered px, or nothing to fall back to the default 170px. */
export function railFirstCardStyle(px: unknown): Record<string, string> | undefined
{
	if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) return undefined;
	const height = `${Math.min(Math.round(px), FIRST_CARD_MAX_PX)}px`;
	return px < FIRST_CARD_ROWS_MIN_PX
		?
			{
				"--session-rail-first-card-h": height,
				"--session-rail-first-card-rows": "none",
			}
		:
			{
				"--session-rail-first-card-h": height,
			};
}

/** The docked rail column's first-card vars for this session's current rail config. */
export function useRailFirstCardStyle(sessionId: string | undefined): Record<string, string> | undefined
{
	const sections = sectionsStore.useValue();
	const heights = bandHeightsStore.useValue();
	if (sessionId === undefined) return undefined;
	return railFirstCardStyle(heights[sessionId]?.[railFirstCardKey(sections, sessionId)]?.px);
}

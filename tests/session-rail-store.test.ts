// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vite-plus/test";

import {
	DEFAULT_RAIL_SECTIONS_STATE,
	isRailSectionOpen,
	readRailSectionsState,
	readSessionRailShown,
	RAIL_SECTIONS_STORAGE_KEY,
	SESSION_RAIL_STORAGE_KEY,
	setRailSectionsOpen,
	setSessionRailShown,
	toggleRailSection,
	type RailSectionsState,
} from "../src/lib/session-rail-store";
import {installLocalStorage} from "./fake-storage";

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
	storage = installLocalStorage();
});

describe("session rail shown state", () => {
	it("starts hidden and persists the global shown flag in upstream's envelope", () => {
		const before = readSessionRailShown();
		setSessionRailShown(true);

		expect({
			before,
			after: readSessionRailShown(),
			stored: JSON.parse(storage.getItem(SESSION_RAIL_STORAGE_KEY) ?? "null"),
		}).toStrictEqual({before: false, after: true, stored: {state: {shown: true}, version: 1}});
	});

	it("reads corrupt or foreign storage as hidden", () => {
		storage.setItem(SESSION_RAIL_STORAGE_KEY, JSON.stringify({state: {shown: true, extra: 1}, version: 1}));
		const extraKey = readSessionRailShown();
		storage.setItem(SESSION_RAIL_STORAGE_KEY, "{not json");

		expect({extraKey, corrupt: readSessionRailShown()}).toStrictEqual({extraKey: false, corrupt: false});
	});
});

describe("rail section folds", () => {
	it("opens Environment and Context by default, and the rest start collapsed", () => {
		const state = DEFAULT_RAIL_SECTIONS_STATE;

		expect({
			environment: isRailSectionOpen(state, "s1", "environment"),
			context: isRailSectionOpen(state, "s1", "context"),
			progress: isRailSectionOpen(state, "s1", "progress"),
		}).toStrictEqual({environment: true, context: true, progress: false});
	});

	it("records a fold per session, and folding back to the default drops the entry", () => {
		toggleRailSection("s1", "environment");
		const collapsed = readRailSectionsState();
		toggleRailSection("s1", "progress");
		const both = readRailSectionsState();
		toggleRailSection("s1", "environment");

		expect({
			collapsed: collapsed.foldsBySession,
			both: both.foldsBySession,
			otherSession: isRailSectionOpen(both, "s2", "environment"),
			restored: readRailSectionsState().foldsBySession,
		}).toStrictEqual({
			collapsed: {s1: {collapsed: ["environment"], expanded: []}},
			both: {s1: {collapsed: ["environment"], expanded: ["progress"]}},
			otherSession: true,
			restored: {s1: {collapsed: [], expanded: ["progress"]}},
		});
	});

	it("sets several cards at once for Alt-click", () => {
		setRailSectionsOpen("s1", ["environment", "context", "progress"], false);

		expect(readRailSectionsState().foldsBySession).toStrictEqual({
			s1: {collapsed: ["environment", "context"], expanded: []},
		});
	});

	it("persists in upstream's envelope under our own key", () => {
		toggleRailSection("s1", "progress");

		const expected: RailSectionsState = {
			foldsBySession: {s1: {collapsed: [], expanded: ["progress"]}},
			startsOpen: {environment: true, context: true},
			hidden: [],
			order: [],
		};
		expect(JSON.parse(storage.getItem(RAIL_SECTIONS_STORAGE_KEY) ?? "null")).toStrictEqual({
			state: expected,
			version: 0,
		});
	});

	it("reads an unknown section id as corrupt storage", () => {
		storage.setItem(
			RAIL_SECTIONS_STORAGE_KEY,
			JSON.stringify({
				state: {...DEFAULT_RAIL_SECTIONS_STATE, hidden: ["mystery"]},
				version: 0,
			}),
		);

		expect(readRailSectionsState()).toStrictEqual(DEFAULT_RAIL_SECTIONS_STATE);
	});
});

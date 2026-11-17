// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vite-plus/test";

import
{
	DEFAULT_RAIL_SECTIONS_STATE,
	RAIL_BAND_HEIGHTS_STORAGE_KEY,
	railFirstCardKey,
	railFirstCardStyle,
	readRailBandHeights,
	recordRailFirstCardHeight,
	isRailSectionOpen,
	isRailSectionsPristine,
	orderRailSections,
	reorderRailSections,
	readRailSectionsState,
	readRailRaiseRequest,
	readSessionRailShown,
	requestRailContextCard,
	resetRailSections,
	toggleRailSectionHidden,
	RAIL_SECTIONS_STORAGE_KEY,
	SESSION_RAIL_STORAGE_KEY,
	setRailSectionsOpen,
	setSessionRailShown,
	toggleRailSection,
	type RailSectionsState,
} from "../src/lib/session-rail-store";
import {installLocalStorage} from "./fake-storage";

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() =>
{
	storage = installLocalStorage();
});

describe("session rail shown state", () =>
{
	it("starts hidden and persists the global shown flag in upstream's envelope", () =>
	{
		const before = readSessionRailShown();
		setSessionRailShown(true);

		expect(
			{
				before,
				after: readSessionRailShown(),
				stored: JSON.parse(storage.getItem(SESSION_RAIL_STORAGE_KEY) ?? "null"),
			},
		).toStrictEqual(
			{
				before: false,
				after: true,
				stored:
				{
					state:
					{
						shown: true,
					},
					version: 1,
				},
			},
		);
	});

	it("reads corrupt or foreign storage as hidden", () =>
	{
		storage.setItem(
			SESSION_RAIL_STORAGE_KEY,
			JSON.stringify(
				{
					state:
					{
						shown: true,
						extra: 1,
					},
					version: 1,
				},
			),
		);
		const extraKey = readSessionRailShown();
		storage.setItem(SESSION_RAIL_STORAGE_KEY, "{not json");

		expect(
			{
				extraKey,
				corrupt: readSessionRailShown(),
			},
		).toStrictEqual(
			{
				extraKey: false,
				corrupt: false,
			},
		);
	});
});

describe("rail section folds", () =>
{
	it("opens every card by default except upstream's Connectors, Context and Usage", () =>
	{
		const state = DEFAULT_RAIL_SECTIONS_STATE;

		expect(
			{
				environment: isRailSectionOpen(state, "s", "environment"),
				backgroundTasks: isRailSectionOpen(state, "s", "backgroundTasks"),
				progress: isRailSectionOpen(state, "s", "progress"),
				connectors: isRailSectionOpen(state, "s", "connectors"),
				context: isRailSectionOpen(state, "s", "context"),
				usage: isRailSectionOpen(state, "s", "usage"),
			},
		).toStrictEqual(
			{
				environment: true,
				backgroundTasks: true,
				progress: true,
				connectors: false,
				context: false,
				usage: false,
			},
		);
	});

	it("records a hand toggle as this session's fold and the new default for unfolded sessions", () =>
	{
		toggleRailSection("s1", "context");
		const opened = readRailSectionsState();
		toggleRailSection("s2", "context");

		expect(
			{
				opened,
				s2BeforeToggle: isRailSectionOpen(opened, "s2", "context"),
				after: readRailSectionsState(),
				s1: isRailSectionOpen(readRailSectionsState(), "s1", "context"),
				s3: isRailSectionOpen(readRailSectionsState(), "s3", "context"),
			},
		).toStrictEqual(
			{
				opened:
				{
					foldsBySession:
					{
						s1:
						{
							collapsed: [],
							expanded: ["context"],
						},
					},
					startsOpen:
					{
						context: true,
					},
					hidden: [],
					order: [],
				},
				s2BeforeToggle: true,
				after:
				{
					foldsBySession:
					{
						s1:
						{
							collapsed: [],
							expanded: ["context"],
						},
						s2:
						{
							collapsed: ["context"],
							expanded: [],
						},
					},
					startsOpen:
					{
						context: false,
					},
					hidden: [],
					order: [],
				},
				s1: true,
				s3: false,
			},
		);
	});

	it("sets several cards at once for Alt-click without changing the defaults", () =>
	{
		setRailSectionsOpen("s1", ["environment", "context", "progress"], false);

		expect(readRailSectionsState()).toStrictEqual(
			{
				foldsBySession:
				{
					s1:
					{
						collapsed: ["environment", "context", "progress"],
						expanded: [],
					},
				},
				startsOpen: {},
				hidden: [],
				order: [],
			},
		);
	});

	it("keeps the folds of the newest 100 sessions", () =>
	{
		for (let index = 0; index <= 100; index++) setRailSectionsOpen(`s${index}`, ["progress"], false);
		toggleRailSection("s1", "goal");

		const keys = Object.keys(readRailSectionsState().foldsBySession);
		expect(
			{
				count: keys.length,
				first: keys[0],
				last: keys.at(-1),
				dropped: keys.includes("s0"),
			},
		).toStrictEqual(
			{
				count: 100,
				first: "s2",
				last: "s1",
				dropped: false,
			},
		);
	});

	it("persists in upstream's envelope under our own key", () =>
	{
		toggleRailSection("s1", "progress");

		const expected: RailSectionsState =
		{
			foldsBySession:
			{
				s1:
				{
					collapsed: ["progress"],
					expanded: [],
				},
			},
			startsOpen:
			{
				progress: false,
			},
			hidden: [],
			order: [],
		};
		expect(JSON.parse(storage.getItem(RAIL_SECTIONS_STORAGE_KEY) ?? "null")).toStrictEqual(
			{
				state: expected,
				version: 0,
			},
		);
	});

	it("reads an unknown section id as corrupt storage", () =>
	{
		storage.setItem(
			RAIL_SECTIONS_STORAGE_KEY,
			JSON.stringify(
				{
					state:
					{
						...DEFAULT_RAIL_SECTIONS_STATE,
						hidden: ["mystery"],
					},
					version: 0,
				},
			),
		);

		expect(readRailSectionsState()).toStrictEqual(DEFAULT_RAIL_SECTIONS_STATE);
	});
});

describe("rail section visibility and reset", () =>
{
	it("hides and shows a section, and Reset to defaults clears hidden, order, defaults and this session's folds", () =>
	{
		const pristine = isRailSectionsPristine(readRailSectionsState(), "s1");
		toggleRailSectionHidden("servers");
		toggleRailSectionHidden("context");
		toggleRailSectionHidden("servers");
		reorderRailSections("context", "environment");
		toggleRailSection("s1", "progress");
		setRailSectionsOpen("s2", ["goal"], false);
		const changed = readRailSectionsState();
		resetRailSections("s1");

		expect(
			{
				pristine,
				hidden: changed.hidden,
				changedPristine: isRailSectionsPristine(changed, "s1"),
				reset: readRailSectionsState(),
				resetPristine: isRailSectionsPristine(readRailSectionsState(), "s1"),
				otherSessionPristine: isRailSectionsPristine(readRailSectionsState(), "s2"),
			},
		).toStrictEqual(
			{
				pristine: true,
				hidden: ["context"],
				changedPristine: false,
				reset:
				{
					foldsBySession:
					{
						s2:
						{
							collapsed: ["goal"],
							expanded: [],
						},
					},
					startsOpen: {},
					hidden: [],
					order: [],
				},
				resetPristine: true,
				otherSessionPristine: false,
			},
		);
	});

	it("counts folds and defaults that all match upstream's defaults as pristine", () =>
	{
		toggleRailSection("s1", "progress");
		toggleRailSection("s1", "progress");
		const state = readRailSectionsState();

		expect(
			{
				state,
				pristine: isRailSectionsPristine(state, "s1"),
				changedDefault: isRailSectionsPristine(
					{
						...state,
						startsOpen:
						{
							context: true,
						},
					},
					"s2",
				),
			},
		).toStrictEqual(
			{
				state:
				{
					foldsBySession:
					{
						s1:
						{
							collapsed: [],
							expanded: ["progress"],
						},
					},
					startsOpen:
					{
						progress: true,
					},
					hidden: [],
					order: [],
				},
				pristine: true,
				changedDefault: false,
			},
		);
	});
});

describe("rail section order", () =>
{
	it("fills the saved ids into the default slots they name, leaving unsaved ids at their default slot", () =>
	{
		expect(
			{
				named: orderRailSections(
					["environment", "context", "outputs", "backgroundTasks"],
					["environment", "backgroundTasks", "context"],
				),
				swapped: orderRailSections(
					["environment", "context", "progress", "backgroundTasks"],
					["progress", "environment"],
				),
			},
		).toStrictEqual(
			{
				named: ["environment", "backgroundTasks", "outputs", "context"],
				swapped: ["progress", "context", "environment", "backgroundTasks"],
			},
		);
	});

	it("anchors Servers just before Background tasks when the saved order predates it", () =>
	{
		expect(
			orderRailSections(
				["environment", "context", "outputs", "servers", "backgroundTasks"],
				["backgroundTasks", "environment", "context", "outputs"],
			),
		).toStrictEqual(["servers", "backgroundTasks", "environment", "context", "outputs"]);
	});

	it("moves the dropped card to the target's slot and saves every section's slot", () =>
	{
		reorderRailSections("progress", "environment");
		const first = readRailSectionsState().order;
		reorderRailSections("progress", "progress");

		expect(
			{
				first,
				unchanged: readRailSectionsState().order,
			},
		).toStrictEqual(
			{
				first: [
					"progress",
					"environment",
					"goal",
					"settings",
					"context",
					"usage",
					"connectors",
					"outputs",
					"pullRequests",
					"servers",
					"backgroundTasks",
				],
				unchanged: [
					"progress",
					"environment",
					"goal",
					"settings",
					"context",
					"usage",
					"connectors",
					"outputs",
					"pullRequests",
					"servers",
					"backgroundTasks",
				],
			},
		);
	});

	it("keeps a section that was empty during a drag at its default place once it shows", () =>
	{
		reorderRailSections("environment", "backgroundTasks");

		expect(
			orderRailSections(["environment", "context", "outputs", "backgroundTasks"], readRailSectionsState().order),
		).toStrictEqual(["context", "outputs", "backgroundTasks", "environment"]);
	});

	it("counts a saved order that merges back to the default as pristine", () =>
	{
		reorderRailSections("progress", "environment");
		reorderRailSections("progress", "connectors");

		expect(isRailSectionsPristine(readRailSectionsState(), "s1")).toBe(true);
	});
});

describe("requestRailContextCard", () =>
{
	it("opens the session's Context card like upstream's setOpen, leaving the card defaults alone, and asks that session's rail on screen", () =>
	{
		const before = readRailSectionsState();
		const raiseBefore = readRailRaiseRequest()?.seq ?? 0;
		requestRailContextCard("s1");
		const state = readRailSectionsState();

		expect(
			{
				open: isRailSectionOpen(state, "s1", "context"),
				startsOpen: state.startsOpen,
				folds: state.foldsBySession["s1"],
				raise: readRailRaiseRequest(),
			},
		).toStrictEqual(
			{
				open: true,
				startsOpen: before.startsOpen,
				folds:
				{
					collapsed: [],
					expanded: ["context"],
				},
				raise:
				{
					sessionId: "s1",
					seq: raiseBefore + 1,
				},
			},
		);
	});
});

describe("rail first card height", () =>
{
	it("keys the height by upstream's rail config: order, hidden, startsOpen and this session's folds", () =>
	{
		const folded: RailSectionsState =
		{
			...DEFAULT_RAIL_SECTIONS_STATE,
			hidden: ["goal"],
			startsOpen:
			{
				context: true,
			},
			foldsBySession:
			{
				s1:
				{
					collapsed: ["environment"],
					expanded: [],
				},
			},
		};

		expect(
			{
				pristine: railFirstCardKey(DEFAULT_RAIL_SECTIONS_STATE, "s1"),
				folded: railFirstCardKey(folded, "s1"),
				otherSession: railFirstCardKey(folded, "s2"),
			},
		).toStrictEqual(
			{
				pristine: "session-rail-first-card:[[],[],{},null]",
				folded: 'session-rail-first-card:[[],["goal"],{"context":true},{"collapsed":["environment"],"expanded":[]}]',
				otherSession: 'session-rail-first-card:[[],["goal"],{"context":true},null]',
			},
		);
	});

	it("stores the rounded height, prunes the session's other first-card keys, and ignores heights at or below 0", () =>
	{
		storage.setItem(
			RAIL_BAND_HEIGHTS_STORAGE_KEY,
			JSON.stringify(
				{
					state:
					{
						bandHeightsBySession:
						{
							s1:
							{
								"session-rail-first-card:old":
								{
									px: 90,
								},
								"session-rail-pr-entries:x":
								{
									px: 40,
								},
							},
							s2:
							{
								"session-rail-first-card:old":
								{
									px: 70,
								},
							},
						},
					},
					version: 0,
				},
			),
		);
		recordRailFirstCardHeight("s1", "session-rail-first-card:new", 111.6);
		recordRailFirstCardHeight("s1", "session-rail-first-card:new", 0);
		recordRailFirstCardHeight("s1", "session-rail-first-card:new", -5);

		expect(
			{
				state: readRailBandHeights(),
				stored: JSON.parse(storage.getItem(RAIL_BAND_HEIGHTS_STORAGE_KEY) ?? "null"),
			},
		).toStrictEqual(
			{
				state:
				{
					s2:
					{
						"session-rail-first-card:old":
						{
							px: 70,
						},
					},
					s1:
					{
						"session-rail-pr-entries:x":
						{
							px: 40,
						},
						"session-rail-first-card:new":
						{
							px: 112,
						},
					},
				},
				stored:
				{
					state:
					{
						bandHeightsBySession:
						{
							s2:
							{
								"session-rail-first-card:old":
								{
									px: 70,
								},
							},
							s1:
							{
								"session-rail-pr-entries:x":
								{
									px: 40,
								},
								"session-rail-first-card:new":
								{
									px: 112,
								},
							},
						},
					},
					version: 0,
				},
			},
		);
	});

	it("keeps heights for only the newest 100 sessions", () =>
	{
		for (let index = 0; index < 101; index++)
			recordRailFirstCardHeight(`s${index}`, "session-rail-first-card:k", 100);
		const sessions = Object.keys(readRailBandHeights());

		expect([sessions.length, sessions[0], sessions.at(-1)]).toStrictEqual([100, "s1", "s100"]);
	});

	it("sizes the skeleton's first card from upstream's remembered px: capped at 360, rows dropped under 86", () =>
	{
		expect(
			[500, 112, 86, 85.6, 80, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, "112", undefined].map((px) =>
				railFirstCardStyle(px),
			),
		).toStrictEqual([
			{
				"--session-rail-first-card-h": "360px",
			},
			{
				"--session-rail-first-card-h": "112px",
			},
			{
				"--session-rail-first-card-h": "86px",
			},
			{
				"--session-rail-first-card-h": "86px",
				"--session-rail-first-card-rows": "none",
			},
			{
				"--session-rail-first-card-h": "80px",
				"--session-rail-first-card-rows": "none",
			},
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});
});

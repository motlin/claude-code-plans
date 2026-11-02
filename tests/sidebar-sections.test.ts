// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it} from "vite-plus/test";

import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import {SESSION_GROUP_STORAGE_KEY} from "../src/lib/session-group-store";
import
{
	DEFAULT_SECTIONS,
	DEFAULT_SECTION_VIEW,
	SIDEBAR_SECTIONS_STORAGE_KEY,
	type SidebarSection,
	migrateToSections,
	moveSection,
	moveSidebarSection,
	normalizeSections,
	setSectionView,
	setSidebarSectionView,
	sortManualSectionsByName,
	useSidebarSections,
} from "../src/lib/sidebar-sections";
import {installLocalStorage} from "./fake-storage";

const VIEW = DEFAULT_SECTION_VIEW;

function manual(id: string, name: string, order: number, members: string[] = []): SidebarSection
{
	return {
		id,
		kind: "manual",
		name,
		order,
		...VIEW,
		members,
	};
}

const PINNED: SidebarSection =
{
	id: "pinned",
	kind: "pinned",
	name: "",
	order: 0,
	...VIEW,
};

function sessions(order: number, groupBy?: SidebarSection["groupBy"]): SidebarSection
{
	return {
		id: "sessions",
		kind: "sessions",
		name: "",
		order,
		...VIEW,
		...(groupBy === undefined
			? {}
			:
				{
					groupBy,
				}),
	};
}

const GROUPS =
{
	groups: [
		{
			id: "cg-a",
			name: "A",
		},
		{
			id: "cg-b",
			name: "B",
		},
	],
	assignments:
	{
		s1: "cg-a",
		s2: "cg-a",
		s3: "cg-b",
	},
	order:
	{
		"cg-a": ["s2"],
	},
};

describe("DEFAULT_SECTIONS", () =>
{
	it("is Pinned then Sessions, with upstream's view defaults", () =>
	{
		expect(
			{
				sections: DEFAULT_SECTIONS,
				view: DEFAULT_SECTION_VIEW,
			},
		).toStrictEqual(
			{
				sections: [PINNED, sessions(1)],
				view:
				{
					sortBy: "activity",
					sortDirection: "desc",
					show:
					{
						metadata: false,
						emptyGroups: false,
					},
				},
			},
		);
	});
});

describe("migrateToSections", () =>
{
	it("turns custom groups into manual sections before Sessions, which stops grouping by custom", () =>
	{
		expect(
			migrateToSections(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy: "custom",
				},
				GROUPS,
			),
		).toStrictEqual([
			PINNED,
			manual("cg-a", "A", 1, ["s2", "s1"]),
			manual("cg-b", "B", 2, ["s3"]),
			sessions(3, "none"),
		]);
	});

	it("maps the old Group by onto the Sessions section (project is folder, state is status)", () =>
	{
		const migrated = (groupBy: "project" | "state" | "date" | "none") =>
			migrateToSections(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy,
					sortBy: "name",
					sortDirection: "asc",
				},
				{
					groups: [],
					assignments: {},
					order: {},
				},
			).at(-1);
		expect(
			{
				project: migrated("project"),
				state: migrated("state"),
				date: migrated("date"),
				none: migrated("none"),
			},
		).toStrictEqual(
			{
				project:
				{
					...sessions(1, "folder"),
					sortBy: "name",
					sortDirection: "asc",
				},
				state:
				{
					...sessions(1, "status"),
					sortBy: "name",
					sortDirection: "asc",
				},
				date:
				{
					...sessions(1, "date"),
					sortBy: "name",
					sortDirection: "asc",
				},
				none:
				{
					...sessions(1, "none"),
					sortBy: "name",
					sortDirection: "asc",
				},
			},
		);
	});
});

describe("normalizeSections", () =>
{
	it("puts Sessions last, keeps one Pinned, drops a member listed twice and renumbers", () =>
	{
		expect(
			normalizeSections([
				sessions(0),
				manual("cg-a", "A", 1, ["s1", "s2"]),
				{
					...PINNED,
					order: 2,
				},
				{
					...PINNED,
					order: 3,
				},
				manual("cg-a", "A again", 4),
				manual("cg-b", "B", 5, ["s2", "s3"]),
			]),
		).toStrictEqual([
			manual("cg-a", "A", 0, ["s1", "s2"]),
			{
				...PINNED,
				order: 1,
			},
			manual("cg-b", "B", 2, ["s3"]),
			sessions(3),
		]);
	});

	it("adds a missing Sessions section at the end", () =>
	{
		expect(normalizeSections([PINNED])).toStrictEqual(DEFAULT_SECTIONS);
	});
});

describe("moveSection", () =>
{
	const list = [PINNED, manual("cg-a", "A", 1), manual("cg-b", "B", 2), sessions(3)];

	it("never moves Sessions", () =>
	{
		expect(moveSection(list, "sessions", 0)).toStrictEqual(list);
	});

	it("clamps a section to the last place before Sessions", () =>
	{
		expect(moveSection(list, "cg-a", 9)).toStrictEqual([
			PINNED,
			manual("cg-b", "B", 1),
			manual("cg-a", "A", 2),
			sessions(3),
		]);
	});

	it("moves a section to the top", () =>
	{
		expect(moveSection(list, "cg-b", -4).map((section) => section.id)).toStrictEqual([
			"cg-b",
			"pinned",
			"cg-a",
			"sessions",
		]);
	});
});

describe("setSectionView", () =>
{
	const list = [PINNED, manual("cg-a", "A", 1), sessions(2)];

	it("resets the direction to descending when the sort switches between Name and another sort", () =>
	{
		const ascending = setSectionView(
			list,
			"cg-a",
			{
				sortDirection: "asc",
			},
		);
		expect(
			{
				toName: setSectionView(
					ascending,
					"cg-a",
					{
						sortBy: "name",
					},
				)[1],
				toCreated: setSectionView(
					ascending,
					"cg-a",
					{
						sortBy: "created",
					},
				)[1],
				explicit: setSectionView(
					ascending,
					"cg-a",
					{
						sortBy: "name",
						sortDirection: "asc",
					},
				)[1],
			},
		).toStrictEqual(
			{
				toName:
				{
					...manual("cg-a", "A", 1),
					sortBy: "name",
					sortDirection: "desc",
				},
				toCreated:
				{
					...manual("cg-a", "A", 1),
					sortBy: "created",
					sortDirection: "asc",
				},
				explicit:
				{
					...manual("cg-a", "A", 1),
					sortBy: "name",
					sortDirection: "asc",
				},
			},
		);
	});

	it("clears the grouping with null and sets Show ▸ Metadata", () =>
	{
		const grouped = setSectionView(
			list,
			"cg-a",
			{
				groupBy: "date",
				show:
				{
					metadata: true,
				},
			},
		);
		expect(
			{
				grouped: grouped[1],
				cleared: setSectionView(
					grouped,
					"cg-a",
					{
						groupBy: null,
					},
				)[1],
			},
		).toStrictEqual(
			{
				grouped:
				{
					...manual("cg-a", "A", 1),
					groupBy: "date",
					show:
					{
						metadata: true,
						emptyGroups: false,
					},
				},
				cleared:
				{
					...manual("cg-a", "A", 1),
					show:
					{
						metadata: true,
						emptyGroups: false,
					},
				},
			},
		);
	});
});

describe("sidebar sections store", () =>
{
	beforeEach(() =>
	{
		installLocalStorage();
	});

	function seedGroups(): void
	{
		localStorage.setItem(SESSION_GROUP_STORAGE_KEY, JSON.stringify(GROUPS));
	}

	it("seeds the sections from the custom groups, then follows new and deleted groups", () =>
	{
		seedGroups();
		const {result} = renderHook(() => useSidebarSections());
		expect(result.current.map((section) => [section.id, section.name, section.members])).toStrictEqual([
			["pinned", "", undefined],
			["cg-a", "A", ["s2", "s1"]],
			["cg-b", "B", ["s3"]],
			["sessions", "", undefined],
		]);
		act(() =>
		{
			moveSidebarSection("cg-b", 1);
		});
		act(() =>
		{
			localStorage.setItem(
				SESSION_GROUP_STORAGE_KEY,
				JSON.stringify(
					{
						groups: [
							{
								id: "cg-b",
								name: "Bee",
							},
							{
								id: "cg-c",
								name: "C",
							},
						],
						assignments: {},
						order: {},
					},
				),
			);
			globalThis.dispatchEvent(
				new StorageEvent(
					"storage",
					{
						key: SESSION_GROUP_STORAGE_KEY,
					},
				),
			);
		});
		expect(result.current.map((section) => [section.id, section.name, section.order])).toStrictEqual([
			["pinned", "", 0],
			["cg-b", "Bee", 1],
			["cg-c", "C", 2],
			["sessions", "", 3],
		]);
	});

	it("persists each section's own view under its own key", () =>
	{
		seedGroups();
		setSidebarSectionView(
			"cg-b",
			{
				groupBy: "status",
				sortBy: "name",
			},
		);
		const raw = localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
		const {result} = renderHook(() => useSidebarSections());
		expect(
			{
				stored:
					raw === null
						? null
						: (
								JSON.parse(raw) as
								{
									sections: SidebarSection[];
								}
							).sections.map((s) => s.id),
				view: result.current.find((section) => section.id === "cg-b"),
			},
		).toStrictEqual(
			{
				stored: ["pinned", "cg-a", "cg-b", "sessions"],
				view:
				{
					...manual("cg-b", "B", 2, ["s3"]),
					groupBy: "status",
					sortBy: "name",
				},
			},
		);
	});

	it("sorts the manual sections A to Z, keeping Pinned first", () =>
	{
		localStorage.setItem(
			SESSION_GROUP_STORAGE_KEY,
			JSON.stringify(
				{
					groups: [
						{
							id: "cg-z",
							name: "zeta",
						},
						{
							id: "cg-a",
							name: "Alpha",
						},
					],
					assignments: {},
					order: {},
				},
			),
		);
		sortManualSectionsByName();
		const {result} = renderHook(() => useSidebarSections());
		expect(result.current.map((section) => section.id)).toStrictEqual(["pinned", "cg-a", "cg-z", "sessions"]);
	});
});

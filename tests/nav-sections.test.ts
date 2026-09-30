import {describe, expect, it} from "vite-plus/test";
import {getVisibleNavItems, navItems} from "../src/components/sidebar/navigation";
import {
	DEFAULT_VISIBLE_NAV_SECTIONS,
	migrateLegacyNavFlags,
	NAV_SECTIONS,
	VisibleNavSectionsSchema,
} from "../src/lib/nav-sections";

function labels(items: ReadonlyArray<{label: string}>): string[] {
	return items.map((item) => item.label);
}

describe("getVisibleNavItems", () => {
	it("pins Artifacts, Plans, Memories and Customize by default and overflows the rest, Sessions included", () => {
		const {pinned, overflow} = getVisibleNavItems(navItems, DEFAULT_VISIBLE_NAV_SECTIONS);

		expect({pinned: labels(pinned), overflow: labels(overflow)}).toStrictEqual({
			pinned: ["Artifacts", "Plans", "Memories", "Customize"],
			overflow: [
				"Routines",
				"Background jobs",
				"Active",
				"Herdr",
				"Tmux Windows",
				"Approvals",
				"Notifications",
				"Tasks",
				"Projects",
				"Sessions",
			],
		});
	});

	it("keeps nav order regardless of the visible list's order", () => {
		const {pinned, overflow} = getVisibleNavItems(navItems, ["sessions", "tasks", "active"]);

		expect({pinned: labels(pinned), overflowCount: overflow.length}).toStrictEqual({
			pinned: ["Active", "Tasks", "Sessions"],
			overflowCount: 11,
		});
	});

	it("moves every section, the session list included, under More when none is pinned", () => {
		const {pinned, overflow} = getVisibleNavItems(navItems, []);

		expect({pinned: labels(pinned), overflowCount: overflow.length}).toStrictEqual({
			pinned: [],
			overflowCount: 14,
		});
	});
});

describe("visibleNavSections schema", () => {
	it("lists every nav section, the session list included, so Edit sidebar can pin it", () => {
		expect(NAV_SECTIONS).toStrictEqual(navItems.map((item) => item.section));
	});

	it("rejects unknown and duplicate sections", () => {
		expect([
			VisibleNavSectionsSchema.safeParse(["plans", "herdr"]).success,
			VisibleNavSectionsSchema.safeParse(["sessions"]).success,
			VisibleNavSectionsSchema.safeParse(["plans", "plans"]).success,
			VisibleNavSectionsSchema.safeParse(["nope"]).success,
		]).toStrictEqual([true, true, false, false]);
	});
});

describe("migrateLegacyNavFlags", () => {
	it("uses the defaults when neither legacy flag was set", () => {
		expect(migrateLegacyNavFlags({})).toStrictEqual(["artifacts", "plans", "memories", "customize"]);
	});

	it("keeps Herdr and Tmux pinned when the old flags showed them", () => {
		expect(migrateLegacyNavFlags({showHerdrSection: true, showTmuxSection: true})).toStrictEqual([
			"artifacts",
			"herdr",
			"tmux",
			"plans",
			"memories",
			"customize",
		]);
	});

	it("moves sections the old flags hid under More", () => {
		expect(migrateLegacyNavFlags({showHerdrSection: false, showTmuxSection: false})).toStrictEqual([
			"artifacts",
			"plans",
			"memories",
			"customize",
		]);
	});
});

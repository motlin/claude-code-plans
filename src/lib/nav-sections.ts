import {z} from "zod";

/** Sidebar sections the user can pin or move under More ▸, in nav order. */
export const NAV_SECTIONS = [
	"projects",
	"artifacts",
	"routines",
	"jobs",
	"active",
	"herdr",
	"approvals",
	"notifications",
	"tasks",
	"plans",
	"memories",
	"sessions",
	"customize",
] as const;

export const NavSectionSchema = z.enum(NAV_SECTIONS);

export type NavSection = z.infer<typeof NavSectionSchema>;

export const VisibleNavSectionsSchema = z
	.array(NavSectionSchema)
	.refine((sections) => new Set(sections).size === sections.length, "Duplicate nav section");

/** Sections that left the nav: Starred became the Pinned group; the rest moved to the account menu. */
const RETIRED_NAV_SECTIONS: ReadonlySet<unknown> = new Set(["starred", "settings", "config", "setup"]);

/** Sections folded into another: Plugins became Customize; Tmux Windows folded into Terminals (`herdr`). */
const RENAMED_NAV_SECTIONS: ReadonlyMap<unknown, NavSection> = new Map([
	["plugins", "customize"],
	["tmux", "herdr"],
]);

/**
 * A saved pin on a renamed section carries over to its successor (once, even if both were pinned; other duplicates stay invalid);
 * retired sections are dropped. Either way the config stays valid.
 */
export function renameLegacyNavSections(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	const sections: unknown[] = value;
	const kept = sections.filter((section) => !RETIRED_NAV_SECTIONS.has(section));
	const result: unknown[] = [];
	for (const section of kept) {
		const successor = RENAMED_NAV_SECTIONS.get(section);
		if (successor === undefined) result.push(section);
		else if (!kept.includes(successor) && !result.includes(successor)) result.push(successor);
	}
	return result;
}

/** Upstream pins New, Projects, Artifacts and Customize; Plans and Memories stay local. */
export const DEFAULT_VISIBLE_NAV_SECTIONS: readonly NavSection[] = [
	"projects",
	"artifacts",
	"plans",
	"memories",
	"customize",
];

function inNavOrder(sections: ReadonlySet<NavSection>): NavSection[] {
	return NAV_SECTIONS.filter((section) => sections.has(section));
}

/** Carry the retired Herdr/Tmux visibility flags into the pinned set; both now pin Terminals (`herdr`). */
export function migrateLegacyNavFlags(legacy: {
	showHerdrSection?: boolean | undefined;
	showTmuxSection?: boolean | undefined;
}): NavSection[] {
	const visible = new Set<NavSection>(DEFAULT_VISIBLE_NAV_SECTIONS);
	if (legacy.showHerdrSection === true || legacy.showTmuxSection === true) visible.add("herdr");
	return inNavOrder(visible);
}

/** Toggle one section, keeping nav order. */
export function toggleNavSection(visible: readonly NavSection[], section: NavSection, pinned: boolean): NavSection[] {
	const next = new Set(visible);
	if (pinned) next.add(section);
	else next.delete(section);
	return inNavOrder(next);
}

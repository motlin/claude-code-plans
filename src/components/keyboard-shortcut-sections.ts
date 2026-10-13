import {objectKeys} from "../lib/narrow";
import {SHORTCUTS, type ShortcutGroup, type ShortcutId} from "../lib/shortcuts/registry";

const SECTION_TITLES = {
	general: "General",
	panes: "Panes",
	composer: "Composer",
} as const satisfies Record<ShortcutGroup, string>;

const SECTION_ORDER = objectKeys(SECTION_TITLES);

export interface ShortcutSection {
	title: string;
	ids: ShortcutId[];
}

/** Registry ids grouped General → Panes → Composer in registry order, skipping empty groups. */
export function shortcutSections(ids: readonly ShortcutId[], include: (id: ShortcutId) => boolean): ShortcutSection[] {
	return SECTION_ORDER.map((group) => ({
		title: SECTION_TITLES[group],
		ids: ids.filter((id) => SHORTCUTS[id].group === group && include(id)),
	})).filter((section) => section.ids.length > 0);
}

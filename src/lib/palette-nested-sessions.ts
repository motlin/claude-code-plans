import {familyKey} from "./sidebar-store";

export interface FamilyFoldAvailability
{
	/** Some listed family is folded: offer Show all nested sessions. */
	anyHidden: boolean;
	/** Some listed family is unfolded: offer Hide all nested sessions. */
	anyShown: boolean;
}

/**
 * Upstream `sS`: which of ⌘K's Hide/Show all nested sessions the listed family heads allow,
 * counting only the `collapsedFamilies` keys that name a listed head.
 */
export function familyFoldState(
	headIds: readonly string[] | null,
	collapsedFamilies: readonly string[],
): FamilyFoldAvailability
{
	if (headIds === null || headIds.length === 0)
	{
		return {
			anyHidden: false,
			anyShown: false,
		};
	}
	const heads = new Set(headIds.map(familyKey));
	const folded = collapsedFamilies.filter((key) => heads.has(key)).length;
	return {
		anyHidden: folded > 0,
		anyShown: folded < heads.size,
	};
}

/** Upstream's catalog rows (`I6`): the description and search hints of each nested-sessions command. */
export const NESTED_SESSION_COMMANDS =
{
	hide_all_nested_sessions:
	{
		label: "Hide all nested sessions",
		keywords: ["Collapse", "Fold sessions"],
	},
	show_all_nested_sessions:
	{
		label: "Show all nested sessions",
		keywords: ["Expand", "Unfold sessions"],
	},
	hide_nested_sessions:
	{
		label: "Hide nested sessions",
		keywords: ["Collapse", "Fold sessions"],
	},
	show_nested_sessions:
	{
		label: "Show nested sessions",
		keywords: ["Expand", "Unfold sessions"],
	},
} as const;

interface MatchWithMeta {
	readonly meta?: ReadonlyArray<unknown> | undefined;
}

/** Upstream's tab title for every code route: claude.ai/code never retitles the tab per page. */
export const APP_TITLE = "Claude Code";

const PAGE_TITLE_META_NAME = "ccb-page-title";

/**
 * A page's own name — the session title, a project name, "Session Not Found" — kept out of the tab
 * title (upstream's is always "Claude Code") but readable by recents and identity checks.
 */
export function pageTitle(title: string): {name: string; content: string} {
	return {name: PAGE_TITLE_META_NAME, content: title};
}

function metaPageTitle(tag: unknown): string | null {
	if (typeof tag !== "object" || tag === null || !("name" in tag) || !("content" in tag)) return null;
	if (tag.name !== PAGE_TITLE_META_NAME) return null;
	return typeof tag.content === "string" && tag.content !== "" ? tag.content : null;
}

/**
 * Page title the resolved route declares with `pageTitle`, innermost match first, the way
 * `HeadContent` picks its `<title>`. Null when no match declares one.
 */
export function resolvedPageTitle(matches: readonly MatchWithMeta[]): string | null {
	for (let i = matches.length - 1; i >= 0; i--) {
		const meta = matches[i]?.meta;
		if (!meta) continue;
		for (let j = meta.length - 1; j >= 0; j--) {
			const title = metaPageTitle(meta[j]);
			if (title !== null) return title;
		}
	}
	return null;
}

interface MatchWithMeta {
	readonly meta?: ReadonlyArray<unknown> | undefined;
}

function metaTitle(tag: unknown): string | null {
	if (typeof tag !== "object" || tag === null || !("title" in tag)) return null;
	return typeof tag.title === "string" && tag.title !== "" ? tag.title : null;
}

/**
 * Title the resolved route asks for, innermost match first, the way `HeadContent` picks it.
 * Null when no match sets a title.
 */
export function resolvedRouteTitle(matches: readonly MatchWithMeta[]): string | null {
	for (let i = matches.length - 1; i >= 0; i--) {
		const meta = matches[i]?.meta;
		if (!meta) continue;
		for (let j = meta.length - 1; j >= 0; j--) {
			const title = metaTitle(meta[j]);
			if (title !== null) return title;
		}
	}
	return null;
}

/**
 * The folder (project) section order model, ported from claude.ai/code's `code-projects-order`
 * helpers. Keys are project names (a `project-<name>` section key without its prefix).
 */

/** Upstream `L8`: an array of distinct strings, first occurrence kept; anything else is no order. */
export function normalizeProjectOrder(raw: unknown): string[]
{
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((key): key is string => typeof key === "string"))];
}

/** Upstream `Hd`: a stored order only applies once one of its keys is a listed project. */
export function projectSortMode(order: readonly string[], present: ReadonlySet<string>): "manual" | "name"
{
	return order.some((key) => present.has(key)) ? "manual" : "name";
}

/** Upstream `PS`: numbers inside names sort numerically (`app2` before `app10`). */
const PROJECT_COLLATOR = new Intl.Collator(
	undefined,
	{
		numeric: true,
	},
);

/** Upstream `eL`: the collator's order, exact ties broken by code unit. */
export function compareProjectNames(first: string, second: string): number
{
	if (first === second) return 0;
	return PROJECT_COLLATOR.compare(first, second) || (first < second ? -1 : 1);
}

/** Upstream `Dx` (a drag): `key` leaves its place and takes `overKey`'s index; null when either is missing or they're the same. */
export function moveProjectKey(order: readonly string[], key: string, overKey: string): string[] | null
{
	const from = order.indexOf(key);
	const to = order.indexOf(overKey);
	if (from < 0 || to < 0 || from === to) return null;
	const next = [...order];
	next.splice(from, 1);
	next.splice(to, 0, key);
	return next;
}

/** Upstream `_e` (Move up / Move down): the key at `from` moves to `to`; null when either index is out of bounds. */
export function moveProjectIndex(visible: readonly string[], from: number, to: number): string[] | null
{
	const key = visible[from];
	if (key === undefined || to < 0 || to >= visible.length) return null;
	const next = [...visible];
	next.splice(from, 1);
	next.splice(to, 0, key);
	return next;
}

/**
 * Upstream `Jm`: write a reordered visible list back into the stored order. Visible keys that
 * weren't stored slot in before the next stored visible key (or at the end), then every visible
 * key's slot takes the next key of `visibleAfter`, so hidden stored keys keep their slots.
 */
export function mergeProjectOrder(
	stored: readonly string[],
	visibleBefore: readonly string[],
	visibleAfter: readonly string[],
): string[]
{
	const storedKeys = new Set(stored);
	const seen = new Set<string>();
	const slots: string[] = [];
	const push = (key: string) =>
	{
		if (seen.has(key)) return;
		seen.add(key);
		slots.push(key);
	};
	let next = 0;
	for (const key of stored)
	{
		if (visibleBefore.includes(key))
		{
			while (
				next < visibleBefore.length &&
				visibleBefore[next] !== key &&
				!storedKeys.has(visibleBefore[next] ?? "")
			)
			{
				push(visibleBefore[next++] ?? "");
			}
			if (visibleBefore[next] === key) next++;
		}
		push(key);
	}
	while (next < visibleBefore.length) push(visibleBefore[next++] ?? "");
	const visible = new Set(visibleBefore);
	const merged: string[] = [];
	let after = 0;
	for (const key of slots)
	{
		if (!visible.has(key)) merged.push(key);
		else if (after < visibleAfter.length) merged.push(visibleAfter[after++] ?? "");
	}
	while (after < visibleAfter.length) merged.push(visibleAfter[after++] ?? "");
	return merged;
}

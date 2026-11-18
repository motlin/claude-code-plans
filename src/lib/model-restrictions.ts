/*
 * Upstream's `availableModels` allowlist (c2319015e `fa`/`ha`, the CLI's `jX` matcher) and its row tooltip
 * (cf6ae6197 `rd` source labels). A restricted Model menu row is disabled with this tooltip.
 */

/** Settings `availableModels` with where it came from, as upstream's host config `{value, source, path}`. */
export interface AvailableModels
{
	value: string[];
	/** The settings source: `user`, `project`, `projectLocal` or `managed`. */
	source: string;
	/** The settings file, tildified; a managed source may name a `policy:<kind>` instead. */
	path: string;
}

const FAMILY_ALIASES: ReadonlySet<string> = new Set(["sonnet", "opus", "haiku", "fable"]);

function normalize(id: string): string
{
	return id
		.trim()
		.toLowerCase()
		.replace(/\[1m\]$/, "");
}

function withVendor(id: string): string
{
	return id.startsWith("claude-") ? id : `claude-${id}`;
}

/**
 * The CLI's `jX`: whether `availableModels` lets a model id run. Family aliases match any id of that family unless
 * the list names a more specific model of it; other entries match by prefix at a `-` boundary, `claude-` implied.
 * An unset list allows everything, an empty one nothing.
 */
export function allowed(id: string, list: readonly string[] | undefined): boolean
{
	if (list === undefined) return true;
	const target = normalize(id);
	const entries = list.map(normalize).filter((entry) => entry !== "");
	return entries.some((entry) =>
	{
		if (FAMILY_ALIASES.has(entry))
		{
			const specific = entries.some((other) => other !== entry && other.includes(entry));
			return !specific && target.includes(entry);
		}
		const prefix = withVendor(entry);
		return target === prefix || target.startsWith(`${prefix}-`);
	});
}

export type RestrictionKind = "allowlist";

/**
 * Upstream's `ha`: a row is `"allowlist"`-restricted when the allowlist leaves it out. An allowlist no row matches is
 * ignored, so a typo (or `[]`) can't lock out every model.
 */
export function restrictionKindFor(
	rowIds: readonly string[],
	availableModels: AvailableModels | null,
): (id: string) => RestrictionKind | undefined
{
	if (availableModels === null || !rowIds.some((id) => allowed(id, availableModels.value))) return () => undefined;
	return (id) => (allowed(id, availableModels.value) ? undefined : "allowlist");
}

const POLICY_PREFIX = "policy:";

/** Upstream's `rd`: who set a setting, from its source and path. */
function sourceLabel(source: string, path: string): string
{
	switch (source)
	{
		case "user":
			return "your Claude Code settings";
		case "project":
			return "this project’s settings";
		case "projectLocal":
			return "this project’s local settings";
		case "managed":
		{
			const kind = path.startsWith(POLICY_PREFIX) ? path.slice(POLICY_PREFIX.length) : "";
			if (kind === "plist" || kind === "hklm" || kind === "hkcu") return "your organization’s device policy";
			if (kind === "remote" || kind === "parent") return "your organization’s policy";
			return "your organization’s managed settings";
		}
		default:
			return "Claude Code settings";
	}
}

/** Upstream's allowlist row tooltip; a `policy:` path names no file, so it is left out. */
export function restrictionTooltip({source, path}: Pick<AvailableModels, "source" | "path">): string
{
	const label = sourceLabel(source, path);
	return path !== "" && !path.startsWith(POLICY_PREFIX)
		? `Not in availableModels set by ${label} (${path})`
		: `Not in availableModels set by ${label}`;
}

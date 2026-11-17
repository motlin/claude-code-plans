/**
 * Upstream's `/status` MCP servers summary (c44e562e8 `cU`, names through `oU`, default cap `sU`).
 */

/** Names shown per segment before `+N more` (`sU`). */
const DEFAULT_NAME_CAP = 5;
const MAX_NAME_CODE_POINTS = 40;

/** Upstream's `oU`: odd characters become spaces, runs collapse, leading spaces/marks and trailing space trim, 40 code points max. */
export function sanitizeMcpName(name: string): string
{
	const cleaned =
		name
			.replace(/[^\p{L}\p{M}\p{N} ._@/:-]/gu, " ")
			.replace(/\s+/g, " ")
			.replace(/^[ \p{M}]+/u, "")
			.trimEnd() || "?";
	const codePoints = Array.from(cleaned);
	return codePoints.length > MAX_NAME_CODE_POINTS
		? `${codePoints.slice(0, MAX_NAME_CODE_POINTS - 1).join("")}…`
		: cleaned;
}

interface Segment
{
	statuses: readonly string[];
	label: (count: number) => string;
}

const SEGMENTS: readonly Segment[] = [
	{
		statuses: ["connected"],
		label: (n) => `${n} connected`,
	},
	{
		statuses: ["needs-auth", "needs_auth"],
		label: (n) => `${n} ${n === 1 ? "needs" : "need"} sign-in`,
	},
	{
		statuses: ["pending", "connecting"],
		label: (n) => `${n} connecting`,
	},
	{
		statuses: ["failed", "error"],
		label: (n) => `${n} failed`,
	},
	{
		statuses: ["disabled"],
		label: (n) => `${n} off`,
	},
];

const KNOWN_STATUSES = new Set(SEGMENTS.flatMap((segment) => segment.statuses));

function segmentText(label: string, names: readonly string[], cap: number): string
{
	const shown = names.slice(0, cap).map(sanitizeMcpName);
	if (names.length > cap) shown.push(`+${names.length - cap} more`);
	return `${label} (${shown.join(", ")})`;
}

/**
 * Upstream's `cU`: "None", or `"<n> <state> (<names>)"` segments joined with " · " in the fixed order
 * connected, sign-in, connecting, failed, off, other. Each lists `cap` names, then `+N more`.
 */
export function mcpStatusSummary(entries: ReadonlyArray<readonly [string, string]>, cap = DEFAULT_NAME_CAP): string
{
	if (entries.length === 0) return "None";
	const namesWith = (match: (status: string) => boolean) =>
		entries.filter(([, status]) => match(status)).map(([name]) => name);
	const groups: Array<[label: (n: number) => string, names: string[]]> = [
		...SEGMENTS.map((segment): [(n: number) => string, string[]] => [
			segment.label,
			namesWith((status) => segment.statuses.includes(status)),
		]),
		[(n) => `${n} other`, namesWith((status) => !KNOWN_STATUSES.has(status))],
	];
	return groups
		.filter(([, names]) => names.length > 0)
		.map(([label, names]) => segmentText(label(names.length), names, cap))
		.join(" · ");
}

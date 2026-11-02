/**
 * Upstream's permission card input rows (claude.ai/code cb6930dae `Mg`/`Og`/`hg`/`gg`/`_g`/`bg`): a tool
 * call's input as key/value rows, top-level keys in words, nested objects as groups of raw code labels.
 */

export interface PermissionRowLeaf
{
	label: string;
	/** The raw key drawn as code, when it can't be put in words. */
	labelCode?: true;
	value: string;
	/** The value is JSON, a bullet list or a scalar, drawn as code. */
	code?: true;
	/** Upstream's 6-line clamp (`_g`). */
	clampLines?: 6;
}

export interface PermissionRowGroup
{
	label: string;
	labelCode?: true;
	rows: PermissionRow[];
}

export type PermissionRow = PermissionRowLeaf | PermissionRowGroup;

const LABEL_MAX = 32;
/** Upstream `ng`: words drawn upper-case, with a trailing `S` turned back to `s`. */
const ACRONYMS = new Set(["id", "ids", "url", "urls", "uri", "uris", "uuid", "uuids", "api", "apis"]);
const BLANK = /^\s*$/u;
// oxlint-disable-next-line no-control-regex -- upstream refuses text with control characters as plain text
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

/** Upstream `og`: at most `max` characters, the last one an ellipsis. */
function truncate(text: string, max = LABEL_MAX): string
{
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/** Upstream `ag`: the key in words, or undefined when it can't be put in words. */
function keyWords(key: string): string | undefined
{
	if (/[^ -~]|["\\<>()]|^-/u.test(key)) return undefined;
	const words = key
		.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
		.split(/[_\-\s]+/u)
		.filter((word) => word !== "")
		.map((word, index) =>
		{
			if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase().replace(/S$/u, "s");
			const lower = word.toLowerCase();
			return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
		})
		.join(" ");
	return BLANK.test(words) ? undefined : words;
}

/** Upstream `ig`: the key in words, truncated. */
function wordsLabel(key: string): string | undefined
{
	const words = keyWords(key);
	return words === undefined ? undefined : truncate(words);
}

/** Upstream `Tg`: the raw key as a code label, JSON-quoted unless it is a plain identifier of at most 32 chars. */
function codeLabel(key: string, max?: number): string
{
	const raw = /^[\w.-]+$/u.test(key) && key.length <= LABEL_MAX ? key : JSON.stringify(key);
	return max === undefined ? raw : truncate(raw, max);
}

/**
 * Upstream `jg`: each top-level key's label. Keys whose labels collide case-insensitively drop to raw code
 * labels: the in-words ones first, else the code labels lose their truncation.
 */
function topLevelLabels(keys: readonly string[])
{
	const forcedCode = new Set<string>();
	const untruncated = new Set<string>();
	const inWords = (key: string) => !forcedCode.has(key) && wordsLabel(key) !== undefined;
	const labelOf = (key: string) =>
		(inWords(key) ? wordsLabel(key) : undefined) ?? codeLabel(key, untruncated.has(key) ? undefined : LABEL_MAX);
	const pass = () =>
	{
		const byLabel = new Map<string, string[]>();
		for (const key of keys)
		{
			const label = labelOf(key).toLowerCase();
			byLabel.set(label, [...(byLabel.get(label) ?? []), key]);
		}
		let changed = false;
		for (const group of byLabel.values())
		{
			if (group.length < 2) continue;
			const worded = group.filter(inWords);
			const target = worded.length > 0 ? forcedCode : untruncated;
			for (const key of worded.length > 0 ? worded : group)
			{
				if (!target.has(key))
				{
					target.add(key);
					changed = true;
				}
			}
		}
		return changed;
	};
	while (pass());
	return {
		labelOf,
		inWords,
	};
}

/** Upstream `pg`: the string's lines, when it is drawable text (some non-blank line, no control characters). */
function textLines(value: unknown): string[] | undefined
{
	if (typeof value !== "string") return undefined;
	const text = value.replaceAll("\r\n", "\n");
	const lines = text.split("\n");
	return !CONTROL.test(text.replace(/[\n\t]/gu, " ")) && lines.some((line) => !BLANK.test(line)) ? lines : undefined;
}

/** Upstream `mg`: an array of single-line strings as `• a` lines. */
function bulletLines(value: unknown): string[] | undefined
{
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const lines = value.map((item) =>
	{
		const itemLines = textLines(item);
		return itemLines?.length === 1 ? `• ${itemLines[0]}` : undefined;
	});
	return lines.every((line) => line !== undefined) ? lines : undefined;
}

/** `JSON.stringify`, which yields undefined for undefined, functions and symbols. */
function jsonText(value: unknown, indent?: number): string | undefined
{
	return JSON.stringify(value, null, indent);
}

const JSON_COMPACT_MAX = 60;
const JSON_PRETTY_LINES_MAX = 10;

/** Upstream `gg`: JSON on one line when short (or when pretty would run long), else 2-space pretty. */
function jsonValue(value: unknown):
{
	value: string;
	code: true;
}
{
	const compact = (jsonText(value, 1) ?? String(value)).replace(/\n */gu, " ");
	const pretty = jsonText(value, 2) ?? compact;
	const lineBreaks = pretty.split("\n").length - 1;
	return {
		value: compact.length <= JSON_COMPACT_MAX || lineBreaks >= JSON_PRETTY_LINES_MAX ? compact : pretty,
		code: true,
	};
}

/** Upstream `hg`: plain text, a bullet list, or JSON. */
function rowValue(value: unknown):
{
	value: string;
	code?: true;
}
{
	const lines = textLines(value);
	if (lines !== undefined)
		return {
			value: lines.join("\n"),
		};
	const bullets = bulletLines(value);
	return bullets === undefined
		? jsonValue(value)
		:
			{
				value: bullets.join("\n"),
				code: true,
			};
}

function isPlainObject(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

const GROUP_JSON_MAX = 8000;

function withinGroupSize(value: unknown): boolean
{
	return (jsonText(value)?.length ?? 0) <= GROUP_JSON_MAX;
}

/** Upstream `wg`: an object, or an array of objects keyed "1", "2", …, that can become a group. */
function groupEntries(value: unknown): Record<string, unknown> | undefined
{
	if (isPlainObject(value)) return value;
	if (!Array.isArray(value) || !withinGroupSize(value)) return undefined;
	const objects = value.filter(isPlainObject);
	if (objects.length === 0 || objects.length !== value.length) return undefined;
	return Object.fromEntries(objects.map((item, index) => [String(index + 1), item]));
}

const GROUP_DEPTH_MAX = 3;

/** Upstream `Dg`: every flattened `parent › child` label fits in 32 chars. */
function flattenFits(prefix: string, entries: Record<string, unknown>): boolean
{
	return Object.keys(entries).every((key) => `${prefix} › ${codeLabel(key)}`.length <= LABEL_MAX);
}

/** Upstream `Og`: nested rows with raw code labels, groups to depth 3, then `a › b` flattening. */
function nestedRows(entries: Record<string, unknown>, depth: number, prefix = ""): PermissionRow[]
{
	return Object.entries(entries).flatMap(([key, value]): PermissionRow[] =>
	{
		const label = `${prefix}${codeLabel(key)}`;
		const group = groupEntries(value);
		if (
			group === undefined ||
			(depth >= GROUP_DEPTH_MAX && (!withinGroupSize(value) || !flattenFits(label, group)))
		)
		{
			return [
				{
					label,
					labelCode: true,
					...rowValue(value),
				},
			];
		}
		if (depth < GROUP_DEPTH_MAX)
			return [
				{
					label,
					labelCode: true,
					rows: nestedRows(group, depth + 1),
				},
			];
		return nestedRows(group, depth, `${label} › `);
	});
}

/** Upstream `Mg`: every key of the input as a row. */
export function inputRows(input: Record<string, unknown>): PermissionRow[]
{
	const keys = Object.keys(input);
	const {labelOf, inWords} = topLevelLabels(keys);
	return keys.map((key): PermissionRow =>
	{
		const group = groupEntries(input[key]);
		return {
			label: labelOf(key),
			...(inWords(key)
				? {}
				:
					{
						labelCode: true as const,
					}),
			...(group === undefined
				? rowValue(input[key])
				:
					{
						rows: nestedRows(group, 1),
					}),
		};
	});
}

/** Upstream `_g`: every leaf clamped to 6 lines. */
export function clampRows(rows: readonly PermissionRow[]): PermissionRow[]
{
	return rows.map((row) =>
		"rows" in row
			?
				{
					...row,
					rows: clampRows(row.rows),
				}
			:
				{
					...row,
					clampLines: 6,
				},
	);
}

const BUDGET_LEAVES = 12;
const BUDGET_VALUE_CHARS = 200;

function leaves(rows: readonly PermissionRow[]): PermissionRowLeaf[]
{
	return rows.flatMap((row) => ("rows" in row ? leaves(row.rows) : [row]));
}

/** Upstream `bg`: at most 12 leaves, each clamped or a single line of at most 200 chars. */
export function rowsFitBudget(rows: readonly PermissionRow[]): boolean
{
	const all = leaves(rows);
	return (
		all.length <= BUDGET_LEAVES &&
		all.every(
			(leaf) =>
				leaf.clampLines !== undefined ||
				(leaf.value.length <= BUDGET_VALUE_CHARS && !leaf.value.includes("\n")),
		)
	);
}

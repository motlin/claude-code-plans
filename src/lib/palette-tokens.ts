import {z} from "zod";
import {UnifiedSearchDateSchema, type UnifiedSearchDate, type UnifiedSearchParams} from "./api/search";
import {paletteFilterLabels, paletteTypeLabels, unifiedSearchDateLabels} from "./schema-choices";
import {assertNever} from "./assert-never";

/**
 * The ⌘K palette's filter grammar, copied from claude.ai/code minus its cloud
 * facets (owner, chats, tasks). See
 * .llm/upstream-sync/features/search-or-start.md task 4.
 */

/** The palette's type tabs in upstream's order, with the local-only types last. */
/** Upstream's code-context tab order (All, Artifacts, Code, Projects, Scheduled), then the local-only types. */
export const PaletteTypeSchema = z.enum([
	"all",
	"artifacts",
	"sessions",
	"projects",
	"scheduled",
	"plans",
	"memories",
	"files",
]);
export type PaletteType = z.infer<typeof PaletteTypeSchema>;

/** The types the palette lists and filters client-side instead of asking `/api/search`. */
export type ClientPaletteType = Extract<PaletteType, "artifacts" | "projects" | "scheduled">;
export type ServerPaletteType = Exclude<PaletteType, ClientPaletteType>;

export function isClientPaletteType(type: PaletteType): type is ClientPaletteType {
	return type === "artifacts" || type === "projects" || type === "scheduled";
}

/** The "Filter by …" hint rows shown when "/" is the whole query. */
export const PaletteFilterSchema = z.enum(["project", "date", "repo", "type", "archived", "actions"]);
export type PaletteFilter = z.infer<typeof PaletteFilterSchema>;

export interface PaletteTokens {
	text: string;
	project?: string;
	date?: UnifiedSearchDate;
	type?: PaletteType;
	archived?: true;
	/** `actions:` narrows the palette to its Actions. */
	actions?: true;
}

const PROJECT_KEYS = new Set(["repo", "repository", "project"]);
const DATE_KEYS = new Set(["date", "when", "active"]);
/** Values that switch on a flag filter (`archived:`, `actions:`); the bare key does too. */
const FLAG_VALUES = new Set(["", "true", "yes"]);

const TYPE_ALIASES: Readonly<Record<string, PaletteType>> = {
	all: "all",
	session: "sessions",
	sessions: "sessions",
	// Upstream's Code tab lists code sessions, the only sessions this app has.
	code: "sessions",
	plan: "plans",
	plans: "plans",
	memory: "memories",
	memories: "memories",
	file: "files",
	files: "files",
	project: "projects",
	projects: "projects",
	artifact: "artifacts",
	artifacts: "artifacts",
	scheduled: "scheduled",
	schedule: "scheduled",
	routine: "scheduled",
	routines: "scheduled",
};

/** Apply one `key:value` word to `tokens`; false leaves the word as search text. */
function applyToken(tokens: PaletteTokens, key: string, rawValue: string): boolean {
	const value = rawValue.toLowerCase();
	if (PROJECT_KEYS.has(key)) {
		if (rawValue !== "") tokens.project = rawValue;
		return true;
	}
	if (DATE_KEYS.has(key)) {
		if (value === "") return true;
		const date = UnifiedSearchDateSchema.safeParse(value);
		if (!date.success) return false;
		tokens.date = date.data;
		return true;
	}
	if (key === "type") {
		if (value === "") return true;
		const type = TYPE_ALIASES[value];
		if (type === undefined) return false;
		tokens.type = type;
		return true;
	}
	if ((key === "is" && value === "archived") || (key === "archived" && FLAG_VALUES.has(value))) {
		tokens.archived = true;
		return true;
	}
	if (key === "actions" && FLAG_VALUES.has(value)) {
		tokens.actions = true;
		return true;
	}
	return false;
}

/** Split a palette query into free text and upstream's inline filter tokens (last one wins). */
export function parsePaletteTokens(query: string): PaletteTokens {
	const tokens: PaletteTokens = {text: ""};
	const words: string[] = [];
	for (const word of query.split(/\s+/u)) {
		if (word === "") continue;
		const match = /^([a-z]+):(.*)$/iu.exec(word);
		if (match?.[1] !== undefined && applyToken(tokens, match[1].toLowerCase(), match[2] ?? "")) {
			continue;
		}
		words.push(word);
	}
	tokens.text = words.join(" ");
	return tokens;
}

export interface PaletteProject {
	id: string;
	name: string;
	projectPath: string | null;
}

function basename(path: string): string {
	return path.replace(/\/+$/u, "").split("/").pop() ?? path;
}

/** True when `value` names `project` by id, name or cwd basename (upstream's `repo:`). */
export function paletteProjectMatches(value: string, project: PaletteProject): boolean {
	if (value === project.id) return true;
	const lower = value.toLowerCase();
	return (
		project.name.toLowerCase() === lower ||
		(project.projectPath !== null && basename(project.projectPath).toLowerCase() === lower)
	);
}

/** Resolve a `repo:`/`project:` value to a project id; unknown values pass through and match nothing. */
export function resolvePaletteProject(value: string, projects: readonly PaletteProject[]): string {
	return projects.find((project) => paletteProjectMatches(value, project))?.id ?? value;
}

export type PaletteSearchParams = Omit<UnifiedSearchParams, "limit">;

/** The `/api/search` params for a parsed query on a tab, or null when the type is searched client-side. */
export function paletteSearchParams(
	tokens: PaletteTokens,
	tab: PaletteType,
	projects: readonly PaletteProject[],
): PaletteSearchParams | null {
	const type = tokens.type ?? tab;
	if (isClientPaletteType(type)) return null;
	return {
		query: tokens.text,
		type,
		...(tokens.project === undefined ? {} : {project: resolvePaletteProject(tokens.project, projects)}),
		...(tokens.date === undefined ? {} : {date: tokens.date}),
	};
}

const FILTER_KEYWORDS = {
	project: ["project"],
	date: ["date", "when", "active", "recent"],
	repo: ["repo", "repository"],
	type: ["type", "kind"],
	archived: ["archived"],
	actions: ["actions", "commands"],
} as const satisfies Record<PaletteFilter, readonly string[]>;

/** The token each hint row inserts into the query. */
export const PALETTE_FILTER_TOKENS = {
	project: "project:",
	date: "date:",
	repo: "repo:",
	type: "type:",
	archived: "archived:",
	actions: "actions:",
} as const satisfies Record<PaletteFilter, string>;

/** Hint rows for a "/…" query, narrowed by keyword prefix; null when the query is not a hint query. */
export function paletteFilterHints(query: string): PaletteFilter[] | null {
	if (!query.startsWith("/") || /\s/u.test(query)) return null;
	const prefix = query.slice(1).toLowerCase();
	return PaletteFilterSchema.options.filter((filter) =>
		FILTER_KEYWORDS[filter].some((keyword) => keyword.startsWith(prefix)),
	);
}

/** The filter a bare `key:` names, including the parser's aliases. */
const BARE_KEY_FILTERS: Readonly<Record<string, PaletteFilter>> = {
	project: "project",
	repo: "repo",
	repository: "repo",
	date: "date",
	when: "date",
	active: "date",
	type: "type",
	archived: "archived",
	actions: "actions",
};

/** How many recent repos or projects a `repo:`/`project:` value list offers, like upstream. */
const PALETTE_VALUE_LIMIT = 10;

export interface PaletteValueSession {
	project: string;
	projectName: string;
}

export interface PaletteFilterValue {
	label: string;
	/** The whole query once this value completes the token. */
	query: string;
}

export interface PaletteValueSuggestions {
	filter: PaletteFilter;
	values: PaletteFilterValue[];
}

/** Distinct, token-safe values in first-seen order, capped at the upstream limit. */
function recentValues(values: Iterable<string>): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (value === "" || /\s/u.test(value)) continue;
		seen.add(value);
		if (seen.size === PALETTE_VALUE_LIMIT) break;
	}
	return [...seen];
}

function filterValues(
	filter: PaletteFilter,
	sessions: readonly PaletteValueSession[],
): Array<[label: string, value: string]> {
	switch (filter) {
		case "date":
			return UnifiedSearchDateSchema.options.map((date) => [unifiedSearchDateLabels[date], date]);
		case "type":
			return (
				PaletteTypeSchema.options
					.filter((type) => type !== "all")
					// The Code tab's token is upstream's `type:code`.
					.map((type) => [paletteTypeLabels[type], type === "sessions" ? "code" : type])
			);
		case "repo":
			return recentValues(sessions.map((session) => basename(session.project))).map((repo) => [repo, repo]);
		case "project":
			return recentValues(sessions.map((session) => session.projectName)).map((name) => [name, name]);
		case "archived":
		case "actions":
			return [[paletteFilterLabels[filter], "true"]];
		default:
			return assertNever(filter);
	}
}

/**
 * The value list shown when the query ends in a bare filter key such as `date:`,
 * or null otherwise. `sessions` are most recent first.
 */
export function paletteValueSuggestions(
	query: string,
	sessions: readonly PaletteValueSession[],
): PaletteValueSuggestions | null {
	const match = /(?:^|\s)([a-z]+):$/iu.exec(query);
	const key = match?.[1];
	if (match === null || key === undefined) return null;
	const filter = BARE_KEY_FILTERS[key.toLowerCase()];
	if (filter === undefined) return null;
	const prefix = query.slice(0, query.length - 1);
	return {
		filter,
		values: filterValues(filter, sessions).map(([label, value]) => ({label, query: `${prefix}:${value} `})),
	};
}

const DAY_MS = 24 * 60 * 60_000;

/** Earliest mtime a `date:` token keeps, matching the server's `/api/search` cutoff. */
export function paletteDateCutoff(date: UnifiedSearchDate, now: number): number {
	if (date === "today") {
		const today = new Date(now);
		return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	}
	return now - (date === "week" ? 7 : 30) * DAY_MS;
}

/** Drop the `type:` tokens so "Search all" really searches every type. */
export function withoutTypeTokens(query: string): string {
	return query
		.split(/\s+/u)
		.filter((word) => word !== "" && !/^type:/iu.test(word))
		.join(" ");
}

type ScrollStrip = {scrollLeft: number; getBoundingClientRect: () => {left: number; right: number}};

/**
 * Upstream's `$t`: scroll the type-tab strip just far enough that `tab` sits inside it,
 * keeping the strip's padding-left (`paddingLeft`, a CSS length) as the margin on both sides.
 */
export function scrollIntoStrip(
	strip: ScrollStrip,
	tab: {getBoundingClientRect: () => {left: number; right: number}},
	paddingLeft: string,
): void {
	const pad = Number.parseFloat(paddingLeft) || 0;
	const stripRect = strip.getBoundingClientRect();
	const tabRect = tab.getBoundingClientRect();
	if (tabRect.left < stripRect.left + pad) {
		strip.scrollLeft -= stripRect.left + pad - tabRect.left;
	} else if (tabRect.right > stripRect.right - pad) {
		strip.scrollLeft += tabRect.right - (stripRect.right - pad);
	}
}

/** The key fields upstream's `yu` reads off a palette keydown. */
export interface PaletteStepKey {
	key: string;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	repeat: boolean;
	composing: boolean;
}

/** The textarea fields upstream's `yu` reads. */
export interface PaletteStepField {
	text: string;
	selectionStart: number | null;
	selectionEnd: number | null;
}

const LETTER = /\p{L}/u;
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** Upstream's `vu`: every letter in `text` reads in the UI's direction (the mixed-bidi guard). */
function lettersMatchDirection(text: string, rtl: boolean): boolean {
	for (const char of text) {
		if (LETTER.test(char) && RTL_LETTER.test(char) !== rtl) return false;
	}
	return true;
}

/**
 * Upstream's `yu`: whether ← / → steps the type tabs (−1 / +1, mirrored in RTL) or moves the caret (0).
 * It steps only with the caret collapsed at the matching edge, never on a held key with text,
 * and never when the query's script direction differs from the UI's.
 */
export function paletteTypeStep(key: PaletteStepKey, field: PaletteStepField, rtl: boolean): -1 | 0 | 1 {
	if (key.key !== "ArrowLeft" && key.key !== "ArrowRight") return 0;
	if (key.shiftKey || key.altKey || key.metaKey || key.ctrlKey || key.composing) return 0;
	const atStart = field.selectionStart === 0;
	const atEnd = field.selectionStart === field.text.length;
	if (field.selectionStart !== field.selectionEnd || !(atStart || atEnd)) return 0;
	if (key.repeat && field.text !== "") return 0;
	const direction = (key.key === "ArrowRight") === rtl ? -1 : 1;
	return (direction === 1 ? atEnd : atStart) && lettersMatchDirection(field.text, rtl) ? direction : 0;
}

/**
 * Upstream's `bu`: the entry `direction` steps from `current`, wrapping both ways when `wrap`
 * (a held key passes false and stops at the ends). Undefined when the step lands back on `current`.
 */
export function nextPaletteType<T>(list: readonly T[], current: T, direction: -1 | 1, wrap: boolean): T | undefined {
	const index = list.indexOf(current);
	const target = index === -1 ? 0 : index + direction;
	const next = wrap ? list[(target + list.length) % list.length] : list[target];
	return next === current ? undefined : next;
}

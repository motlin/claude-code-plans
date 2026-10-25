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
export const PaletteFilterSchema = z.enum(["date", "repo", "project", "type", "archived", "actions"]);
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

/** Upstream's hint keyword table `bt`; a hint also matches on its token prefix. */
const FILTER_KEYWORDS = {
	date: ["date", "when", "recently", "today", "week", "month"],
	repo: ["repo", "repository"],
	project: ["project"],
	type: ["type", "kind"],
	archived: ["archived"],
	actions: ["actions", "commands"],
} as const satisfies Record<PaletteFilter, readonly string[]>;

/** The token each hint row inserts into the query. */
export const PALETTE_FILTER_TOKENS = {
	date: "date:",
	repo: "repo:",
	project: "project:",
	type: "type:",
	archived: "archived:",
	actions: "actions:",
} as const satisfies Record<PaletteFilter, string>;

/** Hint rows for a "/…" query, narrowed by keyword prefix; null when the query is not a hint query. */
export function paletteFilterHints(query: string): PaletteFilter[] | null {
	if (!query.startsWith("/") || /\s/u.test(query)) return null;
	const prefix = query.slice(1).toLowerCase();
	return PaletteFilterSchema.options.filter(
		(filter) =>
			PALETTE_FILTER_TOKENS[filter].startsWith(prefix) ||
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
		// Upstream's Archived and Actions hints commit their chip at once, so they have no values.
		case "archived":
		case "actions":
			return [];
		default:
			return assertNever(filter);
	}
}

/**
 * Upstream's value match: the label without spaces starts with `typed`, or any word of it
 * does (repo labels also split on "/"). Case-insensitive; empty `typed` matches everything.
 */
function valueMatches(filter: PaletteFilter, label: string, typed: string): boolean {
	const lower = label.toLowerCase();
	if (lower.replaceAll(/\s/gu, "").startsWith(typed)) return true;
	return lower.split(filter === "repo" ? /[\s/]+/u : /\s+/u).some((word) => word.startsWith(typed));
}

/**
 * The value list shown when the query's last word is a filter key plus optional typed text,
 * such as `date:` or `repo:pla`, narrowed by that text. Null when the key is unknown, has no
 * values, or none match, so the query falls through to search. `sessions` are most recent first.
 */
export function paletteValueSuggestions(
	query: string,
	sessions: readonly PaletteValueSession[],
): PaletteValueSuggestions | null {
	const match = /(?:^|\s)([a-z]+):(\S*)$/iu.exec(query);
	const key = match?.[1];
	if (match === null || key === undefined) return null;
	const filter = BARE_KEY_FILTERS[key.toLowerCase()];
	if (filter === undefined) return null;
	const typed = match[2] ?? "";
	const head = query.slice(0, query.length - typed.length);
	const values = filterValues(filter, sessions)
		.filter(([label]) => valueMatches(filter, label, typed.toLowerCase()))
		.map(([label, value]) => ({label, query: `${head}${value} `}));
	return values.length === 0 ? null : {filter, values};
}

/** The palette's committed filter chips, kept apart from the query text like upstream's filter object. */
export interface PaletteFilters {
	date?: UnifiedSearchDate;
	repo?: string;
	project?: string;
	archived?: true;
	/** Actions mode is exclusive: it clears every other filter, and any other filter clears it. */
	actions?: true;
}

export interface CommittedPaletteTokens {
	text: string;
	filters: PaletteFilters;
	/** Set when a `type:` token switched the tab; type is a tab, never a chip. */
	tab?: PaletteType;
}

/** The known value matching `value` case-insensitively, in its canonical spelling. */
function knownValue(value: string, known: Iterable<string>): string | undefined {
	const lower = value.toLowerCase();
	for (const candidate of known) {
		if (candidate.toLowerCase() === lower) return candidate;
	}
	return undefined;
}

type FilterChange = {filters: PaletteFilters} | {tab: PaletteType};

/** Upstream's `mt`: the change one `key:value` word commits, or undefined when it doesn't parse. */
function parseCommitToken(
	key: string,
	rawValue: string,
	sessions: readonly PaletteValueSession[],
): FilterChange | undefined {
	const value = rawValue.toLowerCase();
	if (key === "repo" || key === "repository") {
		const repo = knownValue(
			rawValue,
			sessions.map((session) => basename(session.project)),
		);
		return repo === undefined ? undefined : {filters: {repo}};
	}
	if (key === "project") {
		const project = knownValue(
			rawValue,
			sessions.map((session) => session.projectName),
		);
		return project === undefined ? undefined : {filters: {project}};
	}
	if (DATE_KEYS.has(key)) {
		const date = UnifiedSearchDateSchema.safeParse(value);
		return date.success ? {filters: {date: date.data}} : undefined;
	}
	if (key === "type") {
		const tab = TYPE_ALIASES[value];
		return tab === undefined ? undefined : {tab};
	}
	if ((key === "is" && value === "archived") || (key === "archived" && FLAG_VALUES.has(value))) {
		return {filters: {archived: true}};
	}
	if (key === "actions" && FLAG_VALUES.has(value)) return {filters: {actions: true}};
	return undefined;
}

/**
 * Upstream's `ht`: commit each `key:value` word that a whitespace follows into `filters`
 * (or the tab, for `type:`), stripping it and its whitespace from the text. Unknown values
 * and the word still being typed stay as text. `sessions` supply the known repos and projects.
 */
export function commitPaletteTokens(
	query: string,
	filters: PaletteFilters,
	sessions: readonly PaletteValueSession[],
): CommittedPaletteTokens {
	let next: PaletteFilters = {...filters};
	let tab: PaletteType | undefined;
	const text = query.replaceAll(/(?<=^|\s)([a-z]+):(\S*)\s+/giu, (word, key: string, value: string) => {
		const change = parseCommitToken(key.toLowerCase(), value, sessions);
		if (change === undefined) return word;
		if ("tab" in change) {
			tab = change.tab;
		} else if (change.filters.actions === true) {
			next = {actions: true};
		} else {
			const {actions: _actions, ...rest} = next;
			next = {...rest, ...change.filters};
		}
		return "";
	});
	return {text, filters: next, ...(tab === undefined ? {} : {tab})};
}

/** Backspace on an empty query pops the newest filter in this order, like upstream. */
const POP_ORDER = ["actions", "archived", "project", "repo", "date"] as const satisfies ReadonlyArray<
	keyof PaletteFilters
>;

/**
 * Upstream's Backspace pop: remove the first set filter in `POP_ORDER`; with none left,
 * return to the All tab. Null when there is nothing left to pop.
 */
export function popPaletteFilter(
	filters: PaletteFilters,
	tab: PaletteType,
): {filters: PaletteFilters; tab: PaletteType} | null {
	const key = POP_ORDER.find((candidate) => filters[candidate] !== undefined);
	if (key !== undefined) {
		const {[key]: _removed, ...rest} = filters;
		return {filters: rest, tab};
	}
	return tab === "all" ? null : {filters: {}, tab: "all"};
}

/** The committed chips layered over the typed tokens; a chip wins over a token for the same facet. */
export function applyPaletteFilters(tokens: PaletteTokens, filters: PaletteFilters): PaletteTokens {
	const project = filters.project ?? filters.repo;
	return {
		...tokens,
		...(filters.date === undefined ? {} : {date: filters.date}),
		...(project === undefined ? {} : {project}),
		...(filters.archived === undefined ? {} : {archived: true}),
		...(filters.actions === undefined ? {} : {actions: true}),
	};
}

export type PaletteChipFilter = keyof PaletteFilters;

export interface PaletteChip {
	filter: PaletteChipFilter;
	/** The chip's aria-label: "<Name> <Value>", or the bare name for Archived and Actions. */
	label: string;
	/** The full value. */
	title: string;
	/** The visible text; a repo shortens to the name after its last "/" when that is unique. */
	text: string;
}

/** Upstream's chip order (minus its cloud-only owner). */
const CHIP_ORDER = ["actions", "date", "repo", "project", "archived"] as const satisfies readonly PaletteChipFilter[];

function repoChipText(repo: string, repos: readonly string[]): string {
	const name = repo.slice(repo.lastIndexOf("/") + 1);
	if (name === repo) return repo;
	const clashes = repos.some((other) => other !== repo && other.slice(other.lastIndexOf("/") + 1) === name);
	return clashes ? repo : name;
}

function chipValue(filter: PaletteChipFilter, filters: PaletteFilters): string | undefined {
	switch (filter) {
		case "date":
			return filters.date === undefined ? undefined : unifiedSearchDateLabels[filters.date];
		case "repo":
		case "project":
			return filters[filter];
		case "archived":
		case "actions":
			return filters[filter] === undefined ? undefined : paletteFilterLabels[filter];
		default:
			return assertNever(filter);
	}
}

/** The chips for `filters` in upstream's order; `repos` are the known repo values. */
export function paletteChips(filters: PaletteFilters, repos: readonly string[]): PaletteChip[] {
	return CHIP_ORDER.flatMap((filter) => {
		const value = chipValue(filter, filters);
		if (value === undefined) return [];
		const flag = filter === "archived" || filter === "actions";
		return [
			{
				filter,
				label: flag ? value : `${paletteFilterLabels[filter]} ${value}`,
				title: value,
				text: filter === "repo" ? repoChipText(value, repos) : value,
			},
		];
	});
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

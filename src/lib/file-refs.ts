/**
 * Transcript file refs, as on claude.ai/code: inline code whose text names an
 * existing file (optionally `:line` or `:line-end`) becomes a clickable ref
 * that opens the file in the Files pane. Pattern matching only proposes
 * candidates; a ref links only once the server has confirmed the file exists.
 */

/** Why a ref renders as blocked code instead of a link, as upstream's `ir()` reasons. */
export type FileRefBlock = "outside_roots";

export interface FileRef {
	/** Absolute path of the confirmed file, or of the blocked path. */
	path: string;
	line?: number;
	endLine?: number;
	/** Set when the ref can't be opened; it renders as blocked code with the reason. */
	block?: FileRefBlock;
}

export interface ParsedFileRefText {
	/** The path as written, without a leading `./` or a line suffix. */
	target: string;
	line?: number;
	endLine?: number;
}

/**
 * Upstream's file-ref grammar (claude.ai/code `B` in c4aef5f87): at least one
 * `/`, a last segment with an extension, and an optional `:line`, `:line-end`
 * or `:line:col` suffix (the column is dropped).
 */
const NAME_CHARACTERS = String.raw`\p{L}\p{N}\p{M}_`;
const FILE_REF_PATTERN = new RegExp(
	String.raw`^([${NAME_CHARACTERS}.()[\]-]*(?:/[${NAME_CHARACTERS}.()[\]-]+)*/[${NAME_CHARACTERS}()[\]-]*\.\w[\w.-]*)(?::(\d+)(?:-(\d+)|:\d+)?)?$`,
	"u",
);
const MAX_PATH_LENGTH = 1024;

/** Upstream's line-range rule `H`: equal ends collapse, reversed ranges swap. */
function lineRange(start: string | undefined, end: string | undefined): {line?: number; endLine?: number} {
	if (start === undefined) return {};
	const line = Number(start);
	if (end === undefined) return {line};
	const endLine = Number(end);
	if (endLine === line) return {line};
	return endLine < line ? {line: endLine, endLine: line} : {line, endLine};
}

/**
 * Split inline-code text into a path and an optional line range, or null when
 * the text doesn't match upstream's file-ref grammar. Upstream also skips
 * paths its secret scanner flags; this repo has no such scanner.
 */
export function parseFileRefText(text: string): ParsedFileRefText | null {
	if (text.length > MAX_PATH_LENGTH) return null;
	const match = FILE_REF_PATTERN.exec(text);
	if (match === null) return null;
	let target = match[1] ?? "";
	while (target.startsWith("./")) target = target.slice(2);
	return {target, ...lineRange(match[2], match[3])};
}

/** Join and normalize `.`/`..` segments; null if `..` climbs above the root. */
function joinPath(base: string, relativePath: string): string | null {
	const segments: string[] = [];
	for (const segment of `${base}/${relativePath}`.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.pop() === undefined) return null;
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join("/")}`;
}

/**
 * The absolute paths `target` could name, most specific first: the path
 * itself when absolute, otherwise relative to the working directory, then any
 * session path ending in it.
 */
function candidatePaths(target: string, sessionPaths: readonly string[], cwd: string | undefined): string[] {
	if (target.startsWith("/")) {
		const normalized = joinPath("/", target);
		return normalized === null ? [] : [normalized];
	}
	const candidates: string[] = [];
	if (cwd !== undefined) {
		const joined = joinPath(cwd, target);
		if (joined !== null) candidates.push(joined);
	}
	if (!target.split("/").includes("..")) {
		const suffix = `/${target}`;
		for (const path of sessionPaths) {
			if (path.endsWith(suffix) && !candidates.includes(path)) candidates.push(path);
		}
	}
	return candidates;
}

/** Every absolute path the server should stat to resolve these inline codes. */
export function fileRefStatCandidates(
	inlineCodes: Iterable<string>,
	sessionPaths: readonly string[],
	cwd: string | undefined,
): string[] {
	const seen = new Set<string>();
	for (const text of inlineCodes) {
		const parsed = parseFileRefText(text);
		if (parsed === null) continue;
		for (const path of candidatePaths(parsed.target, sessionPaths, cwd)) seen.add(path);
	}
	return [...seen];
}

function resolveTarget(
	target: string,
	known: readonly string[],
	knownSet: ReadonlySet<string>,
	cwd: string | undefined,
): string | null {
	// Suffix candidates come from `known` itself, so only the first needs a check.
	const candidates = candidatePaths(target, known, cwd);
	const [first, ...rest] = candidates;
	const anchored = target.startsWith("/") || cwd !== undefined;
	if (anchored && first !== undefined && knownSet.has(first)) return first;
	if (target.startsWith("/")) return null;
	const suffixMatches = anchored ? rest : candidates;
	return suffixMatches.length === 1 ? (suffixMatches[0] ?? null) : null;
}

function refFor(parsed: ParsedFileRefText, path: string): FileRef {
	const ref: FileRef = {path};
	if (parsed.line !== undefined) ref.line = parsed.line;
	if (parsed.endLine !== undefined) ref.endLine = parsed.endLine;
	return ref;
}

/**
 * Map each inline-code text that names a known, existing file to its ref.
 * `knownPaths` must hold only paths confirmed to exist; a relative path
 * resolves against `cwd` first, then against a unique known path ending in it.
 * A text that names no existing file but resolves the same way among
 * `outsidePaths` (paths confirmed outside the allowed roots) gets a ref
 * blocked as `outside_roots`.
 */
export function resolveFileRefs(
	inlineCodes: Iterable<string>,
	knownPaths: Iterable<string>,
	cwd: string | undefined,
	outsidePaths: Iterable<string> = [],
): Map<string, FileRef> {
	const known = [...knownPaths];
	const knownSet = new Set(known);
	const outside = [...outsidePaths];
	const outsideSet = new Set(outside);
	const refs = new Map<string, FileRef>();
	for (const text of inlineCodes) {
		if (refs.has(text)) continue;
		const parsed = parseFileRefText(text);
		if (parsed === null) continue;
		const path = resolveTarget(parsed.target, known, knownSet, cwd);
		if (path !== null) {
			refs.set(text, refFor(parsed, path));
			continue;
		}
		const blocked = outside.length === 0 ? null : resolveTarget(parsed.target, outside, outsideSet, cwd);
		if (blocked !== null) refs.set(text, {...refFor(parsed, blocked), block: "outside_roots"});
	}
	return refs;
}

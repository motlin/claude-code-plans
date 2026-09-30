/**
 * Transcript file refs, as on claude.ai/code: inline code whose text names an
 * existing file (optionally `:line` or `:line-end`) becomes a clickable ref
 * that opens the file in the Files pane. Pattern matching only proposes
 * candidates; a ref links only once the server has confirmed the file exists.
 */

export interface FileRef {
	/** Absolute path of the confirmed file. */
	path: string;
	line?: number;
	endLine?: number;
}

export interface ParsedFileRefText {
	/** The path as written, without a leading `./` or a line suffix. */
	target: string;
	line?: number;
	endLine?: number;
}

const KNOWN_EXTENSIONS = new Set([
	"astro",
	"bash",
	"c",
	"cfg",
	"cjs",
	"conf",
	"cpp",
	"cs",
	"css",
	"csv",
	"env",
	"fish",
	"gif",
	"go",
	"gradle",
	"h",
	"hpp",
	"html",
	"ini",
	"java",
	"jpeg",
	"jpg",
	"js",
	"json",
	"jsonc",
	"jsonl",
	"jsx",
	"kt",
	"lock",
	"log",
	"md",
	"mdx",
	"mjs",
	"mts",
	"cts",
	"pdf",
	"php",
	"png",
	"properties",
	"py",
	"rb",
	"rs",
	"scss",
	"sh",
	"sql",
	"svelte",
	"svg",
	"swift",
	"toml",
	"ts",
	"tsx",
	"txt",
	"vue",
	"webp",
	"xml",
	"yaml",
	"yml",
	"zsh",
]);

/** Characters that never appear in a path worth linking (shell, globs, code). */
const NON_PATH_CHARACTERS = /[\s()[\]{}<>*?$|;'"`=,!&\\]/;
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/;
const MAX_PATH_LENGTH = 1024;

function hasKnownExtension(name: string): boolean {
	const dot = name.lastIndexOf(".");
	if (dot < 0) return false;
	if (dot === 0) return name.length > 1; // a dotfile such as `.gitignore`
	return KNOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Split inline-code text into a path and an optional line range, or null when
 * the text is not path-like: it needs a `/` or a known extension, and no
 * whitespace, URL scheme, trailing slash (a directory) or code punctuation.
 */
export function parseFileRefText(text: string): ParsedFileRefText | null {
	if (text.length === 0 || text.length > MAX_PATH_LENGTH) return null;
	let target = text;
	let line: number | undefined;
	let endLine: number | undefined;
	const suffix = LINE_SUFFIX.exec(target);
	if (suffix !== null) {
		line = Number(suffix[1]);
		endLine = suffix[2] === undefined ? undefined : Number(suffix[2]);
		if (line < 1 || (endLine !== undefined && endLine < line)) return null;
		target = target.slice(0, suffix.index);
	}
	while (target.startsWith("./")) target = target.slice(2);
	if (
		target === "" ||
		target.endsWith("/") ||
		target.startsWith("~") ||
		target.includes("://") ||
		target.includes(":") ||
		NON_PATH_CHARACTERS.test(target)
	) {
		return null;
	}
	const name = target.slice(target.lastIndexOf("/") + 1);
	if (!target.includes("/") && !hasKnownExtension(name)) return null;
	const parsed: ParsedFileRefText = {target};
	if (line !== undefined) parsed.line = line;
	if (endLine !== undefined) parsed.endLine = endLine;
	return parsed;
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
	return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

/**
 * Map each inline-code text that names a known, existing file to its ref.
 * `knownPaths` must hold only paths confirmed to exist; a relative path
 * resolves against `cwd` first, then against a unique known path ending in it.
 */
export function resolveFileRefs(
	inlineCodes: Iterable<string>,
	knownPaths: Iterable<string>,
	cwd: string | undefined,
): Map<string, FileRef> {
	const known = [...knownPaths];
	const knownSet = new Set(known);
	const refs = new Map<string, FileRef>();
	for (const text of inlineCodes) {
		if (refs.has(text)) continue;
		const parsed = parseFileRefText(text);
		if (parsed === null) continue;
		const path = resolveTarget(parsed.target, known, knownSet, cwd);
		if (path === null) continue;
		const ref: FileRef = {path};
		if (parsed.line !== undefined) ref.line = parsed.line;
		if (parsed.endLine !== undefined) ref.endLine = parsed.endLine;
		refs.set(text, ref);
	}
	return refs;
}

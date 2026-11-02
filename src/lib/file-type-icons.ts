import {z} from "zod";
import rawIconSet from "./file-type-icon-set.json";

// Coloured file-type icons, bundled from upstream's lazily fetched icon sets:
// pierre (@pierre/trees, Apache-2.0) ships in this module; catppuccin
// (Catppuccin Icons for VSCode, MIT) and vscode (Seti, MIT) load on first use.
// See each JSON's `source` and `license`.

const ICON_ELEMENTS = ["g", "path", "circle", "ellipse", "rect"] as const;

const ICON_ATTRIBUTES = [
	"d",
	"fill",
	"opacity",
	"fill-rule",
	"clip-rule",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-dasharray",
	"transform",
	"x",
	"y",
	"width",
	"height",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
] as const;

type FileTypeIconAttribute = (typeof ICON_ATTRIBUTES)[number];

export type FileTypeIconNode =
	| readonly [(typeof ICON_ELEMENTS)[number], Partial<Record<FileTypeIconAttribute, string>>]
	| readonly [
			(typeof ICON_ELEMENTS)[number],
			Partial<Record<FileTypeIconAttribute, string>>,
			readonly FileTypeIconNode[],
	  ];

const IconAttributesSchema = z.partialRecord(z.enum(ICON_ATTRIBUTES), z.string());

const IconNodeSchema: z.ZodType<FileTypeIconNode> = z.lazy(() =>
	z.union([
		z.tuple([z.enum(ICON_ELEMENTS), IconAttributesSchema]),
		z.tuple([z.enum(ICON_ELEMENTS), IconAttributesSchema, z.array(IconNodeSchema)]),
	]),
);

const IconTreeSchema = z
	.string()
	.transform((text, ctx): unknown => {
		try {
			return JSON.parse(text);
		} catch {
			ctx.addIssue({code: "custom", message: "icon is not valid JSON"});
			return z.NEVER;
		}
	})
	.pipe(z.array(IconNodeSchema));

export const FileTypeIconSetSchema = z.strictObject({
	source: z.string(),
	license: z.string(),
	defaultIcon: z.string(),
	defaultForEveryFile: z.boolean().optional(),
	palette: z.record(z.string(), z.tuple([z.string(), z.string()])),
	fileNames: z.record(z.string(), z.string()),
	filePatterns: z.record(z.string(), z.string()).optional(),
	fileExtensions: z.record(z.string(), z.string()),
	icons: z.record(z.string(), IconTreeSchema),
});

export type FileTypeIconSet = z.infer<typeof FileTypeIconSetSchema>;

/** The pierre set, the one bundled with this module. */
export const fileTypeIconSet: FileTypeIconSet = FileTypeIconSetSchema.parse(rawIconSet);

export type FileTypeIconSetName = "pierre" | "catppuccin" | "vscode";

const THEMED_ICON_SETS = ["catppuccin", "pierre", "vscode"] as const satisfies readonly FileTypeIconSetName[];

/**
 * Upstream `Z()`: the icon set a code theme draws, or null (monochrome glyphs)
 * for Claude Light and Claude Dark; otherwise the set whose name prefixes the
 * theme, else pierre.
 */
export function iconSetForCodeTheme(theme: string): FileTypeIconSetName | null {
	if (theme === "claude-light" || theme === "claude-dark") return null;
	return THEMED_ICON_SETS.find((name) => theme.startsWith(`${name}-`)) ?? "pierre";
}

const ICON_SET_IMPORTS: Record<Exclude<FileTypeIconSetName, "pierre">, () => Promise<{default: unknown}>> = {
	catppuccin: async () => import("./file-type-icon-sets/catppuccin.json"),
	vscode: async () => import("./file-type-icon-sets/vscode.json"),
};

const loadedIconSets = new Map<FileTypeIconSetName, FileTypeIconSet>([["pierre", fileTypeIconSet]]);
const iconSetLoads = new Map<FileTypeIconSetName, Promise<FileTypeIconSet>>();
const iconSetListeners = new Set<() => void>();

/** The set when it has loaded (pierre always has), else undefined. */
export function loadedFileTypeIconSet(name: FileTypeIconSetName): FileTypeIconSet | undefined {
	return loadedIconSets.get(name);
}

/** Upstream `D`/`E`: loads a set once, telling subscribers when it arrives; a failed load can be retried. */
export async function loadFileTypeIconSet(name: FileTypeIconSetName): Promise<FileTypeIconSet> {
	const loaded = loadedIconSets.get(name);
	if (loaded !== undefined) return loaded;
	if (name === "pierre") return fileTypeIconSet;
	let load = iconSetLoads.get(name);
	if (load === undefined) {
		load = ICON_SET_IMPORTS[name]().then(({default: raw}) => {
			const set = FileTypeIconSetSchema.parse(raw);
			loadedIconSets.set(name, set);
			for (const listener of iconSetListeners) listener();
			return set;
		});
		load.catch(() => iconSetLoads.delete(name));
		iconSetLoads.set(name, load);
	}
	return load;
}

/** Calls `listener` whenever another set finishes loading. */
export function subscribeFileTypeIconSets(listener: () => void): () => void {
	iconSetListeners.add(listener);
	return () => {
		iconSetListeners.delete(listener);
	};
}

/** Upstream `m5`: the last path segment, ignoring one trailing slash. */
function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]$/, "");
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** Upstream `k`: CLAUDE.md always draws from the pierre set. */
export function fileTypeIconSetFor(path: string, name: FileTypeIconSetName): FileTypeIconSetName {
	return baseName(path).toLowerCase() === "claude.md" ? "pierre" : name;
}

/** Upstream `A`: a `filePatterns` glob, split on `*`, against a lowercased name. */
function matchesFilePattern(name: string, pattern: string): boolean {
	const [first = "", ...middle] = pattern.split("*");
	const last = middle.pop();
	if (last === undefined) return name === first;
	const end = name.length - last.length;
	let at = first.length;
	if (!name.startsWith(first) || !name.endsWith(last) || at > end) return false;
	for (const piece of middle) {
		const found = name.indexOf(piece, at);
		if (found === -1 || found + piece.length > end) return false;
		at = found + piece.length;
	}
	return true;
}

/** Upstream `j`: exact file name, then file patterns, then compound extensions from the first dot. */
function lookUpFileTypeIcon(set: FileTypeIconSet, name: string): string | null {
	if (Object.hasOwn(set.fileNames, name)) return set.fileNames[name] ?? null;
	for (const [pattern, id] of Object.entries(set.filePatterns ?? {})) {
		if (matchesFilePattern(name, pattern)) return id;
	}
	for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
		const extension = name.slice(dot + 1);
		if (Object.hasOwn(set.fileExtensions, extension)) return set.fileExtensions[extension] ?? null;
	}
	return null;
}

/**
 * Upstream `M`: the coloured icon id for a path in a set (pierre unless
 * given), else the set's default icon when it covers every file, else null
 * when only a fallback glyph applies.
 */
export function resolveFileTypeIcon(path: string, set: FileTypeIconSet = fileTypeIconSet): string | null {
	const id = lookUpFileTypeIcon(set, baseName(path).toLowerCase());
	if (id !== null && Object.hasOwn(set.icons, id)) return id;
	return set.defaultForEveryFile === true ? fileTypeIconDefault(set) : null;
}

/** Upstream `N`: the set's default icon, when the set draws it. */
export function fileTypeIconDefault(set: FileTypeIconSet): string | null {
	return Object.hasOwn(set.icons, set.defaultIcon) ? set.defaultIcon : null;
}

export type FileKind = "doc" | "code" | "data" | "sheet" | "preso" | "image" | "archive" | "skill";

export type FileTypeGlyph = FileKind | "note" | "globe";

const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "gz", "bz2", "xz", "7z", "rar", "tgz"]);
const PRESO_EXTENSIONS = new Set(["ppt", "pptx"]);
const DATA_EXTENSIONS = new Set(["jsonl", "parquet", "db", "sqlite", "sqlite3"]);
const SHEET_EXTENSIONS = new Set(["csv", "tsv"]);
const CODE_EXTENSIONS = new Set(
	"js.jsx.gs.ts.tsx.py.rb.go.rs.c.cpp.h.hpp.java.kt.swift.sh.bash.zsh.json.yaml.yml.toml.xml.html.css.scss.sql.graphql.proto.lua.r".split(
		".",
	),
);
const EXTRA_CODE_EXTENSIONS = new Set(["cs", "vue", "pl", "php", "htm", "xhtml"]);
const ICON_IMAGE_EXTENSIONS = new Set(["ico"]);
const DOC_EXTENSIONS = new Set([
	"pdf",
	"md",
	"markdown",
	"txt",
	"log",
	"rtf",
	"doc",
	"docx",
	"odt",
	"pages",
	"rst",
	"tex",
	"epub",
]);
const MEDIA_EXTENSIONS = new Set([
	"mp4",
	"mov",
	"webm",
	"mkv",
	"avi",
	"m4v",
	"ogv",
	"3gp",
	"mp3",
	"wav",
	"ogg",
	"oga",
	"opus",
	"flac",
	"aac",
	"m4a",
	"wma",
	"aiff",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);
const LANGUAGE_NAMES =
	"python.javascript.typescript.java.csharp.go.rust.ruby.php.swift.kotlin.dart.scala.perl.elixir.haskell.clojure.r.groovy.bash.css.scss.less.sql.graphql.json.html.plaintext".split(
		".",
	);

/** Upstream `N9`: the lowercased last extension, or "" when there is no dot. */
function lastExtension(name: string): string {
	const extension = name.split(".").pop()?.toLowerCase() ?? "";
	return extension === name.toLowerCase() ? "" : extension;
}

/** Upstream `fK`, reduced to the cases `sd` reads after its own sets miss. */
function artifactKind(extension: string): FileKind | null {
	if (extension === "skill" || extension === "plugin") return "skill";
	if (["csv", "tsv", "xls", "xlsx"].includes(extension)) return "sheet";
	if (extension === "pptx") return "preso";
	if (["pdf", "md", "docx", "cd", "clark"].includes(extension)) return "doc";
	if (["mermaid", "mmd", "svg"].includes(extension) || IMAGE_EXTENSIONS.has(extension)) return "image";
	if (["jsx", "tsx"].includes(extension) || LANGUAGE_NAMES.includes(extension)) return "code";
	return null;
}

/** Upstream `sd`. */
function extensionKind(extension: string): FileKind | null {
	if (!extension) return null;
	if (extension === "skill" || extension === "plugin") return "skill";
	if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
	if (PRESO_EXTENSIONS.has(extension)) return "preso";
	if (DATA_EXTENSIONS.has(extension)) return "data";
	if (SHEET_EXTENSIONS.has(extension)) return "sheet";
	if (CODE_EXTENSIONS.has(extension) || EXTRA_CODE_EXTENSIONS.has(extension)) return "code";
	if (ICON_IMAGE_EXTENSIONS.has(extension)) return "image";
	if (DOC_EXTENSIONS.has(extension) || MEDIA_EXTENSIONS.has(extension)) return "doc";
	return artifactKind(extension);
}

const EXTENSION_GLYPHS: Readonly<Record<string, FileTypeGlyph>> = {
	md: "note",
	markdown: "note",
	html: "globe",
	htm: "globe",
	xhtml: "globe",
};

/**
 * Upstream `yg`: the monochrome cds glyph for a path when no coloured icon
 * resolves. Only `"doc"` (cds `File`) falls through to the coloured default icon.
 */
export function fileTypeGlyph(path: string): FileTypeGlyph {
	const name = baseName(path);
	if (name.includes("SKILL.md")) return "skill";
	const extension = lastExtension(name);
	const glyph = Object.hasOwn(EXTENSION_GLYPHS, extension) ? EXTENSION_GLYPHS[extension] : undefined;
	return glyph ?? extensionKind(extension) ?? "doc";
}

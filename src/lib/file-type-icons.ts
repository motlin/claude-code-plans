import {z} from "zod";
import rawIconSet from "./file-type-icon-set.json";

// Coloured file-type icons, bundled from upstream's lazily fetched icon set
// (@pierre/trees, Apache-2.0; see the JSON's `source` and `license`).

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

type FileTypeIconNode =
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
	palette: z.record(z.string(), z.tuple([z.string(), z.string()])),
	fileNames: z.record(z.string(), z.string()),
	fileExtensions: z.record(z.string(), z.string()),
	icons: z.record(z.string(), IconTreeSchema),
});

export type FileTypeIconSet = z.infer<typeof FileTypeIconSetSchema>;

export const fileTypeIconSet: FileTypeIconSet = FileTypeIconSetSchema.parse(rawIconSet);

/** Upstream `m5`: the last path segment, ignoring one trailing slash. */
function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]$/, "");
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * Upstream `O`/`k`: the coloured icon id for a path, or null when only a
 * fallback glyph applies.
 */
export function resolveFileTypeIcon(path: string): string | null {
	const name = baseName(path).toLowerCase();
	let id: string | null = null;
	if (Object.hasOwn(fileTypeIconSet.fileNames, name)) {
		id = fileTypeIconSet.fileNames[name] ?? null;
	} else {
		for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
			const extension = name.slice(dot + 1);
			if (Object.hasOwn(fileTypeIconSet.fileExtensions, extension)) {
				id = fileTypeIconSet.fileExtensions[extension] ?? null;
				break;
			}
		}
	}
	return id !== null && Object.hasOwn(fileTypeIconSet.icons, id) ? id : null;
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

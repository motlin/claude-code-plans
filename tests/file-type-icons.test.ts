import rawIconSet from "../src/lib/file-type-icon-set.json";
import {FileTypeIconSetSchema, fileTypeGlyph, fileTypeIconSet, resolveFileTypeIcon} from "../src/lib/file-type-icons";

describe("resolveFileTypeIcon", () => {
	it("resolves exact file names, then compound extensions from the first dot, else null", () => {
		const paths = [
			"CLAUDE.md",
			"docs/README.md",
			".gitignore",
			"Dockerfile",
			"a/b/x.tsx",
			"x.ts",
			"log.jsonl",
			"x.yaml",
			"archive.tar.gz",
			"Main.java",
			"notes.xyz",
			"src/",
			"C:\\repo\\package.json",
			".env.local",
			"page.mdx.tsx",
			"types.d.ts",
		];
		expect(Object.fromEntries(paths.map((p) => [p, resolveFileTypeIcon(p)]))).toStrictEqual({
			"CLAUDE.md": "claude",
			"docs/README.md": "markdown",
			".gitignore": "git",
			Dockerfile: "docker",
			"a/b/x.tsx": "react",
			"x.ts": "typescript",
			"log.jsonl": "json",
			"x.yaml": "yml",
			"archive.tar.gz": "zip",
			"Main.java": null,
			"notes.xyz": null,
			"src/": null,
			"C:\\repo\\package.json": "json",
			".env.local": "text",
			"page.mdx.tsx": "markdown",
			"types.d.ts": "typescript",
		});
	});
});

describe("fileTypeGlyph", () => {
	it("returns upstream's cds-kind fallback glyph for a path", () => {
		const paths = [
			"Main.java",
			"notes.xyz",
			"data.parquet",
			"skills/a/SKILL.md",
			"README.md",
			"notes.markdown",
			"index.html",
			"page.htm",
			"x.kt",
			"x.c",
			"Dockerfile",
			"deck.pptx",
			"sheet.xlsx",
			"table.csv",
			"photo.png",
			"logo.svg",
			"bundle.tar",
			"clip.mp4",
			"diagram.mmd",
			"x.plugin",
			"x.dart",
		];
		expect(Object.fromEntries(paths.map((p) => [p, fileTypeGlyph(p)]))).toStrictEqual({
			"Main.java": "code",
			"notes.xyz": "doc",
			"data.parquet": "data",
			"skills/a/SKILL.md": "skill",
			"README.md": "note",
			"notes.markdown": "note",
			"index.html": "globe",
			"page.htm": "globe",
			"x.kt": "code",
			"x.c": "code",
			Dockerfile: "doc",
			"deck.pptx": "preso",
			"sheet.xlsx": "sheet",
			"table.csv": "sheet",
			"photo.png": "image",
			"logo.svg": "image",
			"bundle.tar": "archive",
			"clip.mp4": "doc",
			"diagram.mmd": "image",
			"x.plugin": "skill",
			"x.dart": "code",
		});
	});
});

describe("FileTypeIconSetSchema", () => {
	it("parses the bundled upstream icon set", () => {
		const parsed = FileTypeIconSetSchema.parse(rawIconSet);
		expect({
			icons: Object.keys(parsed.icons).length,
			fileNames: Object.keys(parsed.fileNames).length,
			fileExtensions: Object.keys(parsed.fileExtensions).length,
			palette: Object.keys(parsed.palette).length,
			defaultIcon: parsed.defaultIcon,
		}).toStrictEqual({icons: 53, fileNames: 100, fileExtensions: 126, palette: 51, defaultIcon: "default"});
	});

	it("exposes parsed icon trees with upstream's attribute values", () => {
		expect(fileTypeIconSet.icons["markdown"]?.[0]).toStrictEqual([
			"path",
			{
				"clip-rule": "evenodd",
				d: "M8 4a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1H8z",
				fill: "$markdown",
				"fill-rule": "evenodd",
				opacity: ".4",
			},
		]);
		expect(fileTypeIconSet.palette["markdown"]).toStrictEqual(["#199f43", "#5ecc71"]);
	});

	it("rejects elements and attributes outside upstream's whitelist", () => {
		const base = {...rawIconSet, icons: {}};
		expect(FileTypeIconSetSchema.safeParse({...base, icons: {x: '[["script",{}]]'}}).success).toBe(false);
		expect(FileTypeIconSetSchema.safeParse({...base, icons: {x: '[["path",{"onload":"y"}]]'}}).success).toBe(false);
		expect(FileTypeIconSetSchema.safeParse({...base, icons: {x: '[["g",{},[["rect",{"x":"1"}]]]]'}}).success).toBe(
			true,
		);
		expect(FileTypeIconSetSchema.safeParse({...base, extra: 1}).success).toBe(false);
	});
});

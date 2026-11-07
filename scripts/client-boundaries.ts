import {readFileSync, readdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {CLIENT_CHUNK_GRAPH_FILE, type ClientChunk} from "../src/lib/client-chunk-graph";

/**
 * `just client-boundaries`: after `vp build`, check the client chunk graph that `clientChunkGraph()` recorded. No client
 * chunk may reference a Node built-in (a route importing a server-only module at the top level), and the client
 * entry's static graph must leave Shiki grammars and markdown-it to dynamic imports. The built stylesheets must keep
 * `:dir()` rather than lightningcss's lowered `:lang()` lists, which ignore direction.
 */

const ClientChunkSchema = z
	.object({
		fileName: z.string().min(1),
		isEntry: z.boolean(),
		imports: z.array(z.string()),
		dynamicImports: z.array(z.string()),
		moduleIds: z.array(z.string()),
	})
	.strict();

const NODE_BUILTIN_PATTERN = /["']node:(fs|fs\/promises|child_process|readline)["']/g;
const CLIENT_ENTRY_PATTERN = /(^|\/)src\/client\.tsx$/;
const SHIKI_LANGUAGE_PATTERN = /(^|\/)shiki\/(dist\/)?langs\//;
const MARKDOWN_IT_PATTERN = /(^|\/)node_modules\/markdown-it\//;

export function clientBoundaryViolations(
	chunks: readonly ClientChunk[],
	codeOf: (fileName: string) => string,
): string[] {
	const violations = new Set<string>();

	for (const chunk of chunks) {
		for (const builtin of new Set(codeOf(chunk.fileName).match(NODE_BUILTIN_PATTERN))) {
			violations.add(`${chunk.fileName}: ${builtin.replace(/["']/g, "")}`);
		}
	}

	const entry = chunks.find((chunk) => chunk.isEntry && chunk.moduleIds.some((id) => CLIENT_ENTRY_PATTERN.test(id)));
	if (entry === undefined) return ["no client entry chunk contains src/client.tsx"];

	const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const staticClosure = new Set<ClientChunk>();
	const toVisit = [entry];
	while (toVisit.length > 0) {
		const chunk = toVisit.pop();
		if (chunk === undefined || staticClosure.has(chunk)) continue;
		staticClosure.add(chunk);
		for (const imported of chunk.imports) {
			const importedChunk = byFileName.get(imported);
			if (importedChunk === undefined) violations.add(`${chunk.fileName}: missing static import ${imported}`);
			else toVisit.push(importedChunk);
		}
	}

	for (const chunk of staticClosure) {
		for (const id of chunk.moduleIds) {
			if (SHIKI_LANGUAGE_PATTERN.test(id) || MARKDOWN_IT_PATTERN.test(id))
				violations.add(`${chunk.fileName}: ${id}`);
		}
		for (const imported of chunk.dynamicImports) {
			const importedChunk = byFileName.get(imported);
			if (importedChunk === undefined) {
				violations.add(`${chunk.fileName}: missing dynamic import ${imported}`);
				continue;
			}
			for (const id of importedChunk.moduleIds) {
				if (SHIKI_LANGUAGE_PATTERN.test(id)) violations.add(`${chunk.fileName} -> ${imported}: ${id}`);
			}
		}
	}

	return [...violations].toSorted();
}

// lightningcss lowers :dir(rtl) to :is(:lang(ae),:lang(ar),…,:lang(yi)); ae is always the list's first entry.
const LOWERED_DIR_MARKER = ":lang(ae)";
const GLOBALS_CSS_PATTERN = /(^|\/)assets\/globals-[^/]*\.css$/;

export function loweredDirSelectorViolations(fileName: string, css: string): string[] {
	if (css.includes(LOWERED_DIR_MARKER)) return [`${fileName}: :dir() was lowered to :lang() lists`];
	if (GLOBALS_CSS_PATTERN.test(fileName) && !css.includes(":dir(rtl)"))
		return [`${fileName}: no :dir(rtl) rule survived the build`];
	return [];
}

function cssViolations(publicDir: string): string[] {
	return readdirSync(join(publicDir, "assets"))
		.filter((name) => name.endsWith(".css"))
		.toSorted()
		.flatMap((name) =>
			loweredDirSelectorViolations(`assets/${name}`, readFileSync(join(publicDir, "assets", name), "utf8")),
		);
}

function main(): void {
	const outputDir = join(fileURLToPath(import.meta.url), "..", "..", ".output");
	const chunks = z
		.array(ClientChunkSchema)
		.parse(JSON.parse(readFileSync(join(outputDir, CLIENT_CHUNK_GRAPH_FILE), "utf8")));
	const violations = clientBoundaryViolations(chunks, (fileName) =>
		readFileSync(join(outputDir, "public", fileName), "utf8"),
	);
	if (violations.length > 0) {
		console.error(
			`The client build crosses a module boundary:\n${violations.map((violation) => `  - ${violation}`).join("\n")}\n\n` +
				"A Node built-in means a route imports a server-only module at the top level: move it inside an API route handler (src/routes/api/) behind a dynamic import().",
		);
		process.exitCode = 1;
	}
	const loweredCss = cssViolations(join(outputDir, "public"));
	if (loweredCss.length > 0) {
		console.error(
			`The built CSS lost its :dir() selectors:\n${loweredCss.map((violation) => `  - ${violation}`).join("\n")}\n\n` +
				"A CSS minify pass lowered :dir() to :lang() lists; keep css.lightningcss.exclude = Features.DirSelector in vite.config.ts.",
		);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}

import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";

/** One client JS chunk as `scripts/client-boundaries.ts` sees it, with root-relative module ids. */
export interface ClientChunk {
	fileName: string;
	isEntry: boolean;
	imports: string[];
	dynamicImports: string[];
	moduleIds: string[];
}

/** Written next to (not inside) the public client output, so it is never served. */
export const CLIENT_CHUNK_GRAPH_FILE = "client-chunks.json";

interface OutputChunkLike {
	type: "chunk";
	fileName: string;
	isEntry: boolean;
	imports: string[];
	dynamicImports: string[];
	moduleIds: string[];
}

interface BuildPlugin {
	name: string;
	apply: "build";
	applyToEnvironment(environment: {name: string}): boolean;
	writeBundle(options: {dir?: string}, bundle: Record<string, {type: string}>): void;
}

function isOutputChunk(item: {type: string}): item is OutputChunkLike {
	return item.type === "chunk";
}

/** Records the client build's chunk graph, so the build's module boundaries can be checked without building again. */
export function clientChunkGraph(root: string): BuildPlugin {
	return {
		name: "ccp:client-chunk-graph",
		apply: "build",
		applyToEnvironment: (environment) => environment.name === "client",
		writeBundle(options, bundle) {
			if (options.dir === undefined) return;
			const chunks: ClientChunk[] = Object.values(bundle)
				.filter(isOutputChunk)
				.map((chunk) => ({
					fileName: chunk.fileName,
					isEntry: chunk.isEntry,
					imports: chunk.imports,
					dynamicImports: chunk.dynamicImports,
					moduleIds: chunk.moduleIds.map((id) => relative(root, id)),
				}));
			const file = join(dirname(options.dir), CLIENT_CHUNK_GRAPH_FILE);
			mkdirSync(dirname(file), {recursive: true});
			writeFileSync(file, `${JSON.stringify(chunks, null, "\t")}\n`);
		},
	};
}

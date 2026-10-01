import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {z} from "zod";
import {ratchet} from "../tests/perf/ratchet";

/**
 * `just perf-bundle` (measurement plan §2.4 L13): after `vp build`, walk the static imports in the Vite client
 * manifest from the client entry plus each route's split component, and ratchet the raw and gzip bytes of the JS a
 * cold load of that route downloads. Dynamic imports (lazy Shiki grammars, other routes) are not part of a cold load.
 */

const ManifestChunkSchema = z
	.object({
		file: z.string().min(1),
		name: z.string().optional(),
		src: z.string().optional(),
		isEntry: z.boolean().optional(),
		isDynamicEntry: z.boolean().optional(),
		imports: z.array(z.string()).optional(),
		dynamicImports: z.array(z.string()).optional(),
		css: z.array(z.string()).optional(),
		assets: z.array(z.string()).optional(),
	})
	.strict();

const ManifestSchema = z.record(z.string().min(1), ManifestChunkSchema);

export type ViteManifest = z.infer<typeof ManifestSchema>;

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PUBLIC_DIR = join(ROOT, ".output", "public");
const MANIFEST_PATH = join(PUBLIC_DIR, ".vite", "manifest.json");

const CLIENT_ENTRY = "src/client.tsx";

const ROUTES: Record<string, string[]> = {
	home: [CLIENT_ENTRY, "src/routes/index.tsx?tsr-split=component"],
	session: [CLIENT_ENTRY, "src/routes/session.$id.tsx?tsr-split=component"],
};

const SHA_PLACEHOLDER = "0000000";

export function coldLoadFiles(manifest: ViteManifest, entryKeys: string[]): string[] {
	const visited = new Set<string>();
	const files = new Set<string>();
	const visit = (key: string): void => {
		if (visited.has(key)) {
			return;
		}
		const chunk = manifest[key];
		if (chunk === undefined) {
			throw new Error(`${key} is not in the Vite client manifest`);
		}
		visited.add(key);
		files.add(chunk.file);
		for (const imported of chunk.imports ?? []) {
			visit(imported);
		}
	};
	for (const key of entryKeys) {
		visit(key);
	}
	return [...files].sort();
}

export function measureBundles(
	manifest: ViteManifest,
	routes: Record<string, string[]>,
	readChunk: (file: string) => string,
): Record<string, number> {
	const measured: Record<string, number> = {};
	for (const name of Object.keys(routes).sort()) {
		let raw = 0;
		let gzip = 0;
		for (const file of coldLoadFiles(manifest, routes[name]!)) {
			const source = Buffer.from(readChunk(file));
			raw += source.byteLength;
			gzip += gzipSync(source).byteLength;
		}
		measured[`bundle.${name}.gzip`] = gzip;
		measured[`bundle.${name}.raw`] = raw;
	}
	return measured;
}

/**
 * vite.config.ts inlines `git rev-parse --short HEAD` as the build sha. Its digits and its length (which grows with the
 * repo's object count, and differs in a shallow CI clone) would move the byte counts, so it is swapped for a fixed
 * placeholder before measuring.
 */
export function normalizeBuildSha(source: string, buildSha: string): string {
	if (!/^[0-9a-f]{4,40}$/.test(buildSha)) {
		return source;
	}
	return source.replaceAll(buildSha, SHA_PLACEHOLDER);
}

const HASHED_NAME = /[\w.$-]+-[\w-]{8}\.[a-z0-9]+/g;
const HASH_SUFFIX = /[\w-]{8}(\.[a-z0-9]+)$/;

/**
 * Chunks import each other by content-hashed file names, so a change confined to a lazy chunk (the build sha lives in
 * one) still rewrites the hash its cold-load importers reference. Same length, different bytes: raw stays put but gzip
 * drifts. Zeroing the hash in every reference to a manifest file keeps the counts tied to the code itself.
 */
export function normalizeChunkHashes(source: string, manifest: ViteManifest): string {
	const names = new Set(
		Object.values(manifest)
			.flatMap((chunk) => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])])
			.map((file) => file.slice(file.lastIndexOf("/") + 1)),
	);
	return source.replace(HASHED_NAME, (name) => (names.has(name) ? name.replace(HASH_SUFFIX, "00000000$1") : name));
}

function currentBuildSha(): string {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: ROOT, encoding: "utf8"}).trim();
	} catch {
		return "unknown";
	}
}

function main(): void {
	const manifest = ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
	const buildSha = currentBuildSha();
	const measured = measureBundles(manifest, ROUTES, (file) =>
		normalizeChunkHashes(normalizeBuildSha(readFileSync(join(PUBLIC_DIR, file), "utf8"), buildSha), manifest),
	);
	const failures: string[] = [];
	for (const [id, value] of Object.entries(measured)) {
		console.log(`${id}: ${value}`);
		try {
			ratchet(id, value);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (failures.length > 0) {
		console.error(failures.join("\n"));
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}

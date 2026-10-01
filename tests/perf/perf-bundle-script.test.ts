import {gzipSync} from "node:zlib";
import {describe, expect, it} from "vite-plus/test";
import {
	coldLoadFiles,
	measureBundles,
	normalizeBuildSha,
	normalizeChunkHashes,
	type ViteManifest,
} from "../../scripts/perf-bundle";

const manifest: ViteManifest = {
	"src/client.tsx": {
		file: "assets/index.js",
		isEntry: true,
		imports: ["_react.js", "_shared.js"],
		dynamicImports: ["src/routes/index.tsx?tsr-split=component", "src/routes/session.$id.tsx?tsr-split=component"],
		css: ["assets/globals.css"],
	},
	"_react.js": {file: "assets/react.js"},
	"_shared.js": {file: "assets/shared.js", imports: ["_react.js"]},
	"src/routes/index.tsx?tsr-split=component": {
		file: "assets/routes.js",
		isDynamicEntry: true,
		imports: ["_shared.js", "_home-only.js"],
		dynamicImports: ["_shiki-lang.js"],
	},
	"_home-only.js": {file: "assets/home-only.js"},
	"src/routes/session.$id.tsx?tsr-split=component": {
		file: "assets/session.js",
		isDynamicEntry: true,
		imports: ["_shared.js"],
		dynamicImports: ["_shiki-lang.js", "_home-only.js"],
	},
	"_shiki-lang.js": {file: "assets/shiki-lang.js", imports: ["_react.js"]},
};

const chunks: Record<string, string> = {
	"assets/index.js": "a".repeat(100),
	"assets/react.js": "b".repeat(40),
	"assets/shared.js": "c".repeat(7),
	"assets/routes.js": "d".repeat(30),
	"assets/home-only.js": "e".repeat(5),
	"assets/session.js": "f".repeat(50),
	"assets/shiki-lang.js": "g".repeat(9000),
};

const routes = {
	home: ["src/client.tsx", "src/routes/index.tsx?tsr-split=component"],
	session: ["src/client.tsx", "src/routes/session.$id.tsx?tsr-split=component"],
};

function gzipBytes(files: string[]): number {
	return files.reduce((sum, file) => sum + gzipSync(chunks[file]!).byteLength, 0);
}

describe("coldLoadFiles", () => {
	it("walks static imports from every entry once, skipping dynamic imports and CSS", () => {
		expect(coldLoadFiles(manifest, routes.home)).toStrictEqual([
			"assets/home-only.js",
			"assets/index.js",
			"assets/react.js",
			"assets/routes.js",
			"assets/shared.js",
		]);
		expect(coldLoadFiles(manifest, routes.session)).toStrictEqual([
			"assets/index.js",
			"assets/react.js",
			"assets/session.js",
			"assets/shared.js",
		]);
	});

	it("fails on a manifest key that does not exist", () => {
		expect(() => coldLoadFiles(manifest, ["src/routes/missing.tsx"])).toThrow(
			"src/routes/missing.tsx is not in the Vite client manifest",
		);
	});
});

describe("measureBundles", () => {
	it("sums raw and gzip bytes of each route's cold-load chunks", () => {
		const measured = measureBundles(manifest, routes, (file) => chunks[file]!);

		expect(measured).toStrictEqual({
			"bundle.home.gzip": gzipBytes([
				"assets/home-only.js",
				"assets/index.js",
				"assets/react.js",
				"assets/routes.js",
				"assets/shared.js",
			]),
			"bundle.home.raw": 182,
			"bundle.session.gzip": gzipBytes([
				"assets/index.js",
				"assets/react.js",
				"assets/session.js",
				"assets/shared.js",
			]),
			"bundle.session.raw": 197,
		});
	});
});

describe("normalizeBuildSha", () => {
	it("replaces the embedded build sha so its length and digits do not move the byte counts", () => {
		expect(normalizeBuildSha("x={buildSha:`02678854`,mode:`prod`};y=`02678854`", "02678854")).toBe(
			"x={buildSha:`0000000`,mode:`prod`};y=`0000000`",
		);
		expect(normalizeBuildSha("x={buildSha:`0267885`}", "0267885")).toBe("x={buildSha:`0000000`}");
	});

	it("leaves the source alone when the sha is unknown", () => {
		expect(normalizeBuildSha("x={buildSha:`unknown`}", "unknown")).toBe("x={buildSha:`unknown`}");
	});
});

describe("normalizeChunkHashes", () => {
	const hashedManifest: ViteManifest = {
		"src/client.tsx": {
			file: "assets/index-B7NvqfPu.js",
			isEntry: true,
			dynamicImports: ["src/lib/perf/field-journeys.ts"],
			css: ["assets/globals-DVxeDL-E.css"],
		},
		"src/lib/perf/field-journeys.ts": {file: "assets/field-journeys-BtLWVvfe.js", isDynamicEntry: true},
		"_vite-browser-external.js": {file: "assets/__vite-browser-external-2447137e-BvRk9kiK.js"},
	};

	it("zeroes the content hash in references to the manifest's own files", () => {
		const source =
			'import("./field-journeys-BtLWVvfe.js");m=["assets/globals-DVxeDL-E.css","assets/__vite-browser-external-2447137e-BvRk9kiK.js"]';

		expect(normalizeChunkHashes(source, hashedManifest)).toBe(
			'import("./field-journeys-00000000.js");m=["assets/globals-00000000.css","assets/__vite-browser-external-2447137e-00000000.js"]',
		);
	});

	it("leaves names that are not manifest files alone", () => {
		const source = 'import("./other-BtLWVvfe.js");x="index-B7NvqfPuX.js"';

		expect(normalizeChunkHashes(source, hashedManifest)).toBe(source);
	});
});

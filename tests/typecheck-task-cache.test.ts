import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {z} from "zod";
import viteConfig from "../vite.config";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("typecheck task cache", () => {
	it("never caches tsc, whose native file reads vp's input tracking cannot see", () => {
		expect(viteConfig.run?.tasks?.["typecheck"]).toStrictEqual({command: "tsc --noEmit", cache: false});
	});

	it("leaves type-checking to `vp check` instead of repeating it in the build", () => {
		const {scripts} = z
			.object({scripts: z.record(z.string(), z.string())})
			.parse(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")));

		expect({
			typeCheckedByVpCheck: viteConfig.lint?.options?.typeCheck,
			build: scripts["build"],
			scriptsCallingTsc: Object.keys(scripts).filter((name) => /\btsc\b/.test(scripts[name] ?? "")),
		}).toStrictEqual({typeCheckedByVpCheck: true, build: "vp build", scriptsCallingTsc: []});
	});
});

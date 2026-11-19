import {readFileSync} from "node:fs";
import {join} from "node:path";
import {parse} from "jsonc-parser";
import {describe, expect, it} from "vite-plus/test";
import {z} from "zod";

const REPO_ROOT = join(import.meta.dirname, "..");

function readRepoFile(name: string): string
{
	return readFileSync(join(REPO_ROOT, name), "utf8");
}

const FallowConfigSchema = z.object(
	{
		ignoreExports: z.array(
			z
				.object(
					{
						file: z.string(),
						exports: z.array(z.string()),
					},
				)
				.strict(),
		),
	},
);

const PackageScriptsSchema = z.object(
	{
		scripts: z.record(z.string(), z.string()),
	},
);

describe("fallow config", () =>
{
	// `fallow fix` answers duplicate-exports by appending {exports: ["*"]} rules, which hide every future dead export in the file.
	it("ignores exports only by name, never with a blanket '*'", () =>
	{
		const config = FallowConfigSchema.parse(parse(readRepoFile(".fallowrc.jsonc")));
		const blanket = config.ignoreExports.filter((rule) => rule.exports.includes("*")).map((rule) => rule.file);
		expect(blanket).toStrictEqual([]);
	});

	it("never runs `fallow fix` from package scripts or pre-commit hooks, so dead code fails instead of being silenced", () =>
	{
		const {scripts} = PackageScriptsSchema.parse(JSON.parse(readRepoFile("package.json")));
		const fixScripts = Object.entries(scripts)
			.filter(([, command]) => /\bfallow fix\b/.test(command))
			.map(([name]) => name);
		expect(fixScripts).toStrictEqual([]);
		expect(readRepoFile(".pre-commit-config.yaml")).toContain("entry: pnpm run fallow:ci --base HEAD\n");
	});
});

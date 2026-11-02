import {readFileSync, readdirSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {StatuslineRateLimitsStrictSchema} from "../src/lib/api/statusline";

const statuslineDir = join(
	process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
	"claude-code-plans",
	"statusline",
);

/** Parsed JSON of a snapshot, or undefined when it is missing or caught mid-write. */
function readSnapshot(file: string): unknown
{
	try
	{
		return JSON.parse(readFileSync(join(statuslineDir, file), "utf-8"));
	}
	catch
	{
		return undefined;
	}
}

describe("statusline rate_limits against disk", () =>
{
	it("knows every rate_limits window the CLI wrote", () =>
	{
		let files: string[];
		try
		{
			files = readdirSync(statuslineDir).filter((file) => file.endsWith(".json"));
		}
		catch
		{
			return;
		}

		const failures = files.flatMap((file) =>
		{
			const json = readSnapshot(file);
			if (typeof json !== "object" || json === null) return [];
			const rateLimits: unknown = "rate_limits" in json ? json.rate_limits : undefined;
			const result = StatuslineRateLimitsStrictSchema.safeParse(rateLimits ?? {});
			return result.success
				? []
				: [
						`${file}: ${result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join(", ")}`,
					];
		});
		expect(failures).toStrictEqual([]);
	});
});

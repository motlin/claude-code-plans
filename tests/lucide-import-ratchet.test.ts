import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/*
 * Every icon should go through the cds `Icon` (src/components/ui/icon.tsx). This ratchet only falls:
 * when a migration removes a file's direct lucide import, lower the ceiling to the new count.
 */
const LUCIDE_IMPORT_CEILING = 164;
const ICON_MODULES = new Set(["src/lib/icon-glyphs.ts", "src/components/ui/icon.tsx"]);

describe("lucide-react import ratchet", () =>
{
	it(`keeps the files importing lucide-react directly at or below ${LUCIDE_IMPORT_CEILING}`, () =>
	{
		const offenders = globSync("src/**/*.{ts,tsx}")
			.filter((path) => !ICON_MODULES.has(path))
			.filter((path) => readFileSync(path, "utf8").includes('from "lucide-react"'))
			.toSorted();
		expect(
			offenders.length,
			`${offenders.length} files import lucide-react directly; draw new icons with <Icon>:\n${offenders.join("\n")}`,
		).toBeLessThanOrEqual(LUCIDE_IMPORT_CEILING);
	});
});

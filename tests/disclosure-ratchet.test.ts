import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/*
 * Disclosures should go through the cds `Collapsible` (src/components/ui/collapsible.tsx), as upstream's `kT`
 * does. This ratchet counts the hand-rolled ones left in src/components: `<details>` elements and
 * `aria-expanded={…}` toggles that aren't menu or popover triggers (`aria-haspopup` on the same element).
 * It only falls: when a migration removes one, lower the ceiling to the new count. The sidebar group header,
 * diff-file header and subagent tree stay hand-rolled; upstream draws those with their own components. The
 * permission rows' Show more (upstream's cds Button with aria-expanded over a line-clamped value) toggles a clamp,
 * not a hidden panel, so a Collapsible can't draw it; it raised the ceiling from 45. The "Claude Code notice" row
 * (hook-notice-row.tsx) copies upstream's own `d_` button and epitaxy expanding body, not the cds Collapsible, so it
 * raised the ceiling from 46.
 */
const DISCLOSURE_CEILING = 47;

/** The opening tag around `index`: from the nearest `<Name` before it to the next `<` after it. */
function enclosingTag(source: string, index: number): string
{
	const before = source.slice(0, index);
	const start = Math.max(before.lastIndexOf("<"), 0);
	const next = source.indexOf("<", index);
	return source.slice(start, next === -1 ? source.length : next);
}

function handRolledDisclosures(source: string): number
{
	const details = source.match(/<details[\s>]/g)?.length ?? 0;
	const toggles = [...source.matchAll(/aria-expanded=\{/g)].filter(
		(match) => !enclosingTag(source, match.index).includes("aria-haspopup"),
	).length;
	return details + toggles;
}

describe("hand-rolled disclosure ratchet", () =>
{
	it(`keeps the hand-rolled disclosures in src/components at or below ${DISCLOSURE_CEILING}`, () =>
	{
		const counts = globSync("src/components/**/*.tsx")
			.filter((path) => !path.startsWith("src/components/ui/"))
			.map((path) => (
			{
				path,
				count: handRolledDisclosures(readFileSync(path, "utf8")),
			}))
			.filter(({count}) => count > 0)
			.toSorted((a, b) => a.path.localeCompare(b.path));
		const total = counts.reduce((sum, {count}) => sum + count, 0);
		expect(
			total,
			`${total} hand-rolled disclosures; draw new ones with <Collapsible>:\n${counts.map(({path, count}) => `${count} ${path}`).join("\n")}`,
		).toBeLessThanOrEqual(DISCLOSURE_CEILING);
	});

	it("counts details elements and expanded toggles but skips menu triggers", () =>
	{
		expect(
			handRolledDisclosures(
				'<details open><summary/></details>\n<button aria-expanded={open} onClick={toggle}>x</button>\n<button aria-haspopup="menu" aria-expanded={menuOpen}>y</button>',
			),
		).toBe(2);
	});
});

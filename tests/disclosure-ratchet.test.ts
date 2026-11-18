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
 * raised the ceiling from 46. The usage ring popover's Context window toggle and its deferred groups copy upstream's
 * own buttons (c2d611398 `ne`, ce96f5751 `se` without `rail`), whose state the popover owns and resets on close, so
 * they raised it from 47. The Background tasks pane's Show more / Show less (upstream `mv`) pages more rows into the
 * same list rather than revealing a panel, so a Collapsible can't draw it either; it raised the ceiling from 49. The
 * `/usage` card's attribution Show N more / Show less (upstream `SV`, a ghost cds Button) does the same; it raised the
 * ceiling from 50. The docked question card's "View question options" caret (c9ed5627b) is upstream's own ghost
 * button in its header (shared-41 `d3`), with cds Collapsibles only around the options and actions it hides, so it
 * raised the ceiling from 51. The peer message row's Show more / Show less (upstream `qt`, a ghost cds Button with
 * aria-expanded) toggles a 16rem clamp on the body it sits under, not a hidden panel; it raised the ceiling from 52.
 * A clipped label-only tool row's text toggle (upstream `$W`'s `Gd` with `controls`) unclips the row's own label in
 * place, with no panel to hide, so it raised the ceiling from 53.
 */
const DISCLOSURE_CEILING = 54;

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

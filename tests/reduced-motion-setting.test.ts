import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function rulesFor(selectorPrefix: string): string[]
{
	return [
		...styles.matchAll(
			/^((?:html\[data-reduce-motion="true"\][^\n{]*,\n)*html\[data-reduce-motion="true"\][^\n{]*)\s*\{\n([^}]*)\}/gm,
		),
	]
		.filter((match) => match[1]?.includes(selectorPrefix) === true)
		.map((match) => `${match[1]}\n{\n${match[2]}}`);
}

describe("Settings ▸ Motion ▸ Reduced", () =>
{
	it("collapses every animation under the OS query or html[data-reduce-motion=true], as upstream's global pair does", () =>
	{
		expect(
			{
				os: styles.includes(
					"@media (prefers-reduced-motion: reduce)\n{\n\t*,\n\t::before,\n\t::after\n\t{\n\t\tanimation-duration: 0.01ms !important;\n\t\tanimation-iteration-count: 1 !important;\n\t}\n}",
				),
				attribute: styles.includes(
					'[data-reduce-motion="true"] *,\n[data-reduce-motion="true"] ::before,\n[data-reduce-motion="true"] ::after\n{\n\tanimation-duration: 0.01ms !important;\n\tanimation-iteration-count: 1 !important;\n}',
				),
				legacyRootAttribute: styles.includes("html[data-motion="),
			},
		).toStrictEqual(
			{
				os: true,
				attribute: true,
				legacyRootAttribute: false,
			},
		);
	});

	it("stops every looping animation, including the cds Spinner ring", () =>
	{
		expect(rulesFor(".animate-pulse")).toStrictEqual([
			'html[data-reduce-motion="true"] .animate-pulse,\n' +
				'html[data-reduce-motion="true"] .animate-ping,\n' +
				'html[data-reduce-motion="true"] .animate-approval-inline-enter,\n' +
				'html[data-reduce-motion="true"] .animate-question-receipt-enter,\n' +
				'html[data-reduce-motion="true"] .animate-palette-card-in,\n' +
				'html[data-reduce-motion="true"] .df-tab-dot-running,\n' +
				'html[data-reduce-motion="true"] .terminal-caret,\n' +
				'html[data-reduce-motion="true"] [data-spinner] *\n{\n' +
				"\tanimation: none !important;\n}",
		]);
	});

	it("holds the ⌘K palette at full size instead of receding behind the row-actions card", () =>
	{
		expect(rulesFor("[data-palette-recede-card]")).toStrictEqual([
			'html[data-reduce-motion="true"] [data-palette-recede-card]\n{\n\tscale: none !important;\n}',
		]);
	});

	it("hides the ShimmerText clone, as the OS reduced-motion query does", () =>
	{
		expect(rulesFor("[data-cds-shimmer-clone]")).toStrictEqual([
			'html[data-reduce-motion="true"] [data-cds-shimmer-clone]\n{\n\tdisplay: none;\n}',
		]);
	});

	it("hides the Skeleton sheen, as motion-reduce:after:hidden does", () =>
	{
		expect(rulesFor('[data-cds="Skeleton"]')).toStrictEqual([
			'html[data-reduce-motion="true"] [data-cds="Skeleton"]::after\n{\n\tdisplay: none;\n}',
		]);
	});
});

function sources(dir: string): string[]
{
	return readdirSync(dir).flatMap((name) =>
	{
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

/** A transform/translate/scale transition: transition-transform or transition-[…transform|translate|scale…]. */
const TRANSFORM_TRANSITION = /(?<![\w-])transition-(?:transform|\[[^\]\s]*(?:transform|translate|scale)[^\]\s]*\])/;

/** Class strings whose gate lives in an interpolated constant. */
const GATED_ELSEWHERE: Record<string, string> =
{
	// SHEET_MOTION = "… motion-reduce:transition-none".
	"src/components/ui/popover-sheet.tsx": "${SHEET_MOTION}",
	"src/components/ui/menu-sheet.tsx": "${SHEET_MOTION}",
};

describe("Reduced motion leaves ungated transitions alone, like upstream", () =>
{
	it("sets no transition from a [data-reduce-motion] universal rule", () =>
	{
		expect(
			[...styles.matchAll(/^([^\n{}]*\[data-reduce-motion="true"\][^\n{}]*\*[^{}]*)\{([^}]*)\}/gm)]
				.filter((match) => /(?:^|[\s;])transition(?:-[a-z]+)?:/.test(match[2] ?? ""))
				.map((match) => match[1]?.trim()),
		).toStrictEqual([]);
	});

	it("gates every transform, translate and scale transition with motion-reduce:transition-none or motion-safe:", () =>
	{
		const offenders = sources("src").flatMap((path) =>
			[...readFileSync(path, "utf8").matchAll(/"[^"\n]*"|`[^`]*`/g)]
				.map((match) => match[0])
				.filter(
					(literal) =>
						TRANSFORM_TRANSITION.test(literal) &&
						!literal.includes("motion-reduce:transition-none") &&
						!literal.includes("motion-safe:") &&
						!(GATED_ELSEWHERE[path] !== undefined && literal.includes(GATED_ELSEWHERE[path])),
				)
				.map((literal) => `${path}: ${literal.slice(0, 80)}`),
		);

		expect(offenders).toStrictEqual([]);
	});
});

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {ruleStart} from "./css-rule";

const css = readFileSync(join(import.meta.dirname, "../src/styles/globals.css"), "utf8");

const HUES = ["blue", "orange", "violet", "red", "aqua", "yellow", "magenta", "green"] as const;

/** The body of the top-level rule whose selector starts a line, up to its closing brace. */
function block(selector: string): string
{
	const start = ruleStart(css, `\n${selector}`);
	if (start === -1) throw new Error(`no ${selector} block`);
	const end = css.indexOf("\n}\n", start + 1);
	return css.slice(start, end);
}

function tints(body: string): Record<string, [string | undefined, string | undefined]>
{
	const read = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]+);`).exec(body)?.[1];
	return Object.fromEntries(
		HUES.map((hue) => [hue, [read(`upstream-bg-tint-${hue}`), read(`upstream-text-tint-${hue}`)]]),
	);
}

describe("artifact mark tint tokens", () =>
{
	// dumps/artifact-mark-primitive-tint-tokens-2026-11-04.txt: upstream fizzy `color` --cds-bg-tint-* / --cds-text-tint-*.
	it("copies upstream's fizzy-lake bg-tint and text-tint for every hue, light and dark", () =>
	{
		expect(
			{
				light: tints(block(':root[data-cds-fizzy-lake~="color"]')),
				dark: tints(block(':root.dark[data-cds-fizzy-lake~="color"]')),
			},
		).toStrictEqual(
			{
				light:
				{
					blue: ["#257de01f", "#1757ac"],
					orange: ["#d25f2524", "#90370f"],
					violet: ["#785ee81f", "#5437b8"],
					red: ["#dc3c3d1f", "#a42528"],
					aqua: ["#019c7f24", "#006458"],
					yellow: ["#fbb31529", "#794c02"],
					magenta: ["#ce447d1f", "#902552"],
					green: ["#10a12224", "#006c10"],
				},
				dark:
				{
					blue: ["#257de01f", "#6aabf1"],
					orange: ["#d25f251f", "#f18a59"],
					violet: ["#785ee81f", "#a89af0"],
					red: ["#dc3c3d1f", "#f17778"],
					aqua: ["#019c7f1f", "#2bc6a5"],
					yellow: ["#fbb31514", "#e49c06"],
					magenta: ["#ce447d1f", "#ee7fac"],
					green: ["#10a1221f", "#53c556"],
				},
			},
		);
	});

	it("defines a bg-tint-<hue> and text-tint-<hue> utility per hue reading its own variable", () =>
	{
		const utilities = HUES.flatMap((hue) => [
			new RegExp(
				`@utility bg-tint-${hue}\\s*\\{\\s*background-color: var\\(--upstream-bg-tint-${hue}\\);\\s*\\}`,
			).test(css),
			new RegExp(`@utility text-tint-${hue}\\s*\\{\\s*color: var\\(--upstream-text-tint-${hue}\\);\\s*\\}`).test(
				css,
			),
		]);
		expect(utilities).toStrictEqual(
			Array.from(
				{
					length: 16,
				},
				() => true,
			),
		);
	});
});

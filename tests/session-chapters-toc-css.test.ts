import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";
import {ruleStart} from "./css-rule";

const styles = readFileSync("src/styles/globals.css", "utf8");
const normalised = styles.replaceAll(/\s+/g, " ");

function block(selector: string): string
{
	const start = ruleStart(styles, `\n${selector}`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("\n}", start));
}

function token(source: string, name: string): string | null
{
	return source.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1] ?? null;
}

async function compile(candidate: string): Promise<string>
{
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return (rule ?? "").replaceAll(/\s+/g, " ").trim();
}

describe("session outline CSS", () =>
{
	it("fades the outline in with upstream's injected keyframes, shortened under reduced motion", () =>
	{
		expect(
			{
				keyframes: normalised.includes(
					"@keyframes epitaxy-toc-fade-in { 0% { opacity: 0; } to { opacity: 1; } }",
				),
				animation: normalised.includes(
					".epitaxy-toc-fade-in { animation: 0.18s ease-out 0.12s both epitaxy-toc-fade-in; }",
				),
				reducedMotion: normalised.includes(
					"@media (prefers-reduced-motion: reduce) { .epitaxy-toc-fade-in { animation-duration: 1ms; } }",
				),
			},
		).toStrictEqual(
			{
				keyframes: true,
				animation: true,
				reducedMotion: true,
			},
		);
	});

	it("defines upstream's alpha-5 and alpha-8 inks (neutral-900 at 50% and 85%) for the dashes", async () =>
	{
		expect(
			{
				light: [token(block(":root"), "--upstream-alpha-5"), token(block(":root"), "--upstream-alpha-8")],
				dark: [token(block(".dark"), "--upstream-alpha-5"), token(block(".dark"), "--upstream-alpha-8")],
				hover: await compile("bg-alpha-5"),
				active: await compile("bg-alpha-8"),
			},
		).toStrictEqual(
			{
				light: ["rgb(11 11 11 / 0.5)", "rgb(11 11 11 / 0.85)"],
				dark: ["rgb(255 255 255 / 0.5)", "rgb(255 255 255 / 0.85)"],
				hover: ".bg-alpha-5 { background-color: var(--upstream-alpha-5); }",
				active: ".bg-alpha-8 { background-color: var(--upstream-alpha-8); }",
			},
		);
	});

	it("compiles upstream's list-row height and 3px hit gap", async () =>
	{
		expect(
			{
				row: await compile("h-list-row"),
				gap: await compile("hit-gap-y-0.75"),
			},
		).toStrictEqual(
			{
				row: ".h-list-row { height: calc(2rem * var(--cds-rem-scale, 1)); }",
				gap: ".hit-gap-y-0\\.75 { row-gap: calc(var(--spacing) * 0.75); & > :where(:not(:last-child)) { --cds-hit-gap-y: calc(var(--spacing) * 0.75); } }",
			},
		);
	});

	it("defaults the chat gutter to upstream's 32px outside line mode", () =>
	{
		expect(token(block(":root"), "--chat-gutter")).toBe("32px");
	});
});

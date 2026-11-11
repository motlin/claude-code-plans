import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

const styles = readFileSync("src/styles/globals.css", "utf8");

function rootBlock(): string {
	const start = styles.indexOf("\n:root {");
	return styles.slice(start, styles.indexOf("\n}", start));
}

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1] ?? null;
}

async function compile(candidate: string): Promise<string> {
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return (rule ?? "").replaceAll(/\s+/g, " ").trim();
}

describe("Pulse / indicator slot CSS", () => {
	it("aliases upstream's --cds-* names the Pulse reads onto the local upstream tokens", () => {
		const root = rootBlock();
		expect(
			Object.fromEntries(
				[
					"--cds-page-bg",
					"--cds-fill-accent",
					"--cds-fill-warning",
					"--cds-fill-success",
					"--cds-fill-danger",
					"--cds-fill-brand",
					"--cds-text-muted",
				].map((name) => [name, token(root, name)]),
			),
		).toStrictEqual({
			"--cds-page-bg": "var(--upstream-page)",
			"--cds-fill-accent": "var(--upstream-fill-accent)",
			"--cds-fill-warning": "var(--upstream-fill-warning)",
			"--cds-fill-success": "var(--upstream-fill-success)",
			"--cds-fill-danger": "var(--upstream-fill-danger)",
			"--cds-fill-brand": "var(--upstream-fill-brand)",
			"--cds-text-muted": "var(--upstream-text-muted)",
		});
	});

	it("drops the hand-tuned #fab219 awaiting dot for upstream's --cds-fill-warning", () => {
		expect({
			awaiting: styles.includes("--status-dot-awaiting"),
			awaitingRule: styles.includes('.status-dot[data-kind="awaiting"]'),
			readyRule: styles.includes('.status-dot[data-kind="ready"]'),
		}).toStrictEqual({awaiting: false, awaitingRule: false, readyRule: false});
	});

	it("blinks the running Pulse with upstream's df-tab-dot-running and stops it under reduced motion", async () => {
		expect({
			rule: styles.includes(".df-tab-dot-running {\n\tanimation: dframe-dot-blink 1.2s ease-in-out infinite;\n}"),
			keyframes: styles.includes(
				"@keyframes dframe-dot-blink {\n\t0%,\n\t100% {\n\t\topacity: 0.3;\n\t}\n\t50% {\n\t\topacity: 1;\n\t}\n}",
			),
			osReducedMotion: styles.includes("@media (prefers-reduced-motion: reduce) {\n\t.df-tab-dot-running,"),
			legacyRule: styles.includes('.status-dot[data-kind="running"]'),
			fizzySolidMuted: token(
				styles.slice(styles.indexOf('\n:root[data-cds-fizzy-lake~="color"] {')),
				"--cds-fizzy-lake-color-solid-muted",
			),
			remap: await compile("stacks:[--cds-text-muted:var(--cds-fizzy-lake-color-solid-muted)]"),
		}).toStrictEqual({
			rule: true,
			keyframes: true,
			osReducedMotion: true,
			legacyRule: false,
			fizzySolidMuted: "#878787",
			remap: '@media (forced-colors: none) { .stacks\\:\\[--cds-text-muted\\:var\\(--cds-fizzy-lake-color-solid-muted\\)\\]:where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *)) { --cds-text-muted: var(--cds-fizzy-lake-color-solid-muted); } }',
		});
	});

	it("animates only under motion-safe: (which honours data-reduce-motion)", async () => {
		expect(await compile("motion-safe:animate-pulse")).toBe(
			'@media (prefers-reduced-motion: no-preference) { .motion-safe\\:animate-pulse:not(:where([data-reduce-motion="true"], [data-reduce-motion="true"] *)) { animation: var(--animate-pulse); } }',
		);
	});

	it("notches the icon only when the indicator holds a Pulse, outside forced colors", async () => {
		const rule = await compile(
			"not-forced-colors:has-[~[data-cds-part=indicator]>[data-cds=Pulse]]:[mask-image:radial-gradient(circle_at_var(--btn-dot-x)_calc(var(--btn-dot-r)_-_1px),transparent_calc(var(--btn-dot-r)_+_2px),black_calc(var(--btn-dot-r)_+_2.5px))]",
		);
		expect({
			media: rule.includes("@media not (forced-colors: active)"),
			has: rule.includes(":has( ~ [data-cds-part=indicator] > [data-cds=Pulse])"),
			mask: rule.includes(
				"mask-image: radial-gradient(circle at var(--btn-dot-x) calc(var(--btn-dot-r) - 1px),transparent calc(var(--btn-dot-r) + 2px),black calc(var(--btn-dot-r) + 2.5px))",
			),
		}).toStrictEqual({media: true, has: true, mask: true});
	});

	it("mirrors the notch centre in RTL", async () => {
		expect(await compile("[&:dir(rtl)]:[--btn-dot-x:calc(var(--btn-dot-r)_-_1px)]")).toBe(
			".\\[\\&\\:dir\\(rtl\\)\\]\\:\\[--btn-dot-x\\:calc\\(var\\(--btn-dot-r\\)_-_1px\\)\\]:dir(rtl) { --btn-dot-x: calc(var(--btn-dot-r) - 1px); }",
		);
	});
});

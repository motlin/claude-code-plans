import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** Whitespace collapsed, with none just inside parentheses, so wrapped declarations compare flat. */
function normalised(text: string): string {
	return text.replaceAll(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");
}

/**
 * The declarations of the first rule whose selector list is exactly `selector` (not the tail of a
 * longer list), normalised.
 */
function rule(selector: string): string | null {
	const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	const match = new RegExp(String.raw`(?:^|[^,])\n${escaped} \{\n`).exec(styles);
	if (match === null) return null;
	const open = match.index + match[0].length;
	return normalised(styles.slice(open, styles.indexOf("\n}", open))).trim();
}

function includes(needle: string): boolean {
	return normalised(styles).includes(normalised(needle));
}

const SHIMMERING = '[data-cds="ShimmerText"][data-shimmering="true"]';

describe("ShimmerText CSS", () => {
	it("inks each variant from upstream's I6 map", () => {
		expect({
			default: rule(SHIMMERING),
			defaultDark: rule(`.dark ${SHIMMERING}`),
			secondary: rule(`${SHIMMERING}[data-variant="secondary"]`),
			secondaryDark: rule(`.dark ${SHIMMERING}[data-variant="secondary"]`),
			muted: rule(`${SHIMMERING}[data-variant="muted"],\n.dark ${SHIMMERING}[data-variant="muted"]`),
			strong: rule(`${SHIMMERING}[data-variant="strong"],\n.dark ${SHIMMERING}[data-variant="strong"]`),
			strongDark: rule(`.dark ${SHIMMERING}[data-variant="strong"]`),
		}).toStrictEqual({
			default:
				"--cds-shimmer-text-ink: var(--upstream-text-primary); --cds-shimmer-text-peak: color-mix(in srgb, var(--upstream-text-primary) 30%, white);",
			defaultDark:
				"--cds-shimmer-text-ink: var(--upstream-text-secondary); --cds-shimmer-text-peak: var(--upstream-text-primary);",
			secondary:
				"--cds-shimmer-text-ink: var(--upstream-text-secondary); --cds-shimmer-text-peak: color-mix(in srgb, var(--upstream-text-secondary) 30%, white);",
			secondaryDark:
				"--cds-shimmer-text-ink: var(--upstream-text-muted); --cds-shimmer-text-peak: color-mix(in srgb, var(--upstream-text-muted) 30%, white);",
			muted: "--cds-shimmer-text-ink: var(--upstream-text-muted); --cds-shimmer-text-peak: color-mix(in srgb, var(--upstream-text-muted) 30%, white);",
			strong: "--cds-shimmer-text-ink: var(--upstream-text-primary); --cds-shimmer-text-peak: color-mix(in srgb, var(--upstream-text-primary) 45%, white); --cds-shimmer-text-band-stops: var(--cds-shimmer-text-bell-band-stops); --cds-shimmer-text-keyframes: cds-shimmer-text-band-strong; --cds-shimmer-text-keyframes-rtl: cds-shimmer-text-band-strong-rtl;",
			strongDark: "--cds-shimmer-text-peak: #7b7974;",
		});
	});

	it("sweeps the clone band from the variant's keyframes, stops, delay and play state", () => {
		expect({
			after: includes(
				'[data-cds-shimmer-clone]::after { content: ""; background-image: linear-gradient(120deg, var(--cds-shimmer-text-band-stops, transparent 37.5%, var(--cds-shimmer-text-peak, transparent) 50%, transparent 62.5%)); animation: 3s linear infinite cds-shimmer-text-band; animation-name: var(--cds-shimmer-text-keyframes, cds-shimmer-text-band); animation-delay: var(--cds-shimmer-text-delay, 0s); animation-play-state: var(--cds-shimmer-text-play-state, running);',
			),
			rtl: includes(
				'[data-cds-shimmer-clone]:where(:root[dir="rtl"] :dir(rtl))::after { background-image: linear-gradient(240deg, var(--cds-shimmer-text-band-stops, transparent 37.5%, var(--cds-shimmer-text-peak, transparent) 50%, transparent 62.5%)); animation-name: var(--cds-shimmer-text-keyframes-rtl, cds-shimmer-text-band-rtl);',
			),
			bellBand: includes(
				"--cds-shimmer-text-bell-band-stops: transparent 37.5%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 16%, transparent) 41%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 46%, transparent) 44%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 83%, transparent) 47%, var(--cds-shimmer-text-peak, transparent) 50%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 83%, transparent) 53%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 46%, transparent) 56%, color-mix(in srgb, var(--cds-shimmer-text-peak, transparent) 16%, transparent) 59%, transparent 62.5%;",
			),
		}).toStrictEqual({after: true, rtl: true, bellBand: true});
	});

	it("gates the clone on upstream's @supports and hides it under forced colors", () => {
		expect({
			hiddenOutside: rule("[data-cds-shimmer-clone]"),
			supports: includes(
				"@supports (-webkit-mask-clip: text) and (-webkit-app-region: drag) { [data-cds-shimmer-clone] {",
			),
			forcedColors: includes(
				'@media (forced-colors: active) { [data-cds="ShimmerText"][data-shimmering="true"] { -webkit-text-fill-color: CanvasText; } [data-cds-shimmer-clone] { display: none; }',
			),
		}).toStrictEqual({hiddenOutside: "display: none;", supports: true, forcedColors: true});
	});

	it("draws the fallback shine on the span, with the strong bell variant", () => {
		expect({
			fallback: rule('[data-cds="ShimmerText"][data-shimmer-mode="fallback"]'),
			strong: rule('[data-cds="ShimmerText"][data-shimmer-mode="fallback"][data-variant="strong"]'),
		}).toStrictEqual({
			fallback:
				"background-clip: text; -webkit-text-fill-color: transparent; background-repeat: no-repeat; background-size: 400% 100%; background-position: 83.333% 0%; background-image: linear-gradient(var(--cds-shimmer-text-angle, 120deg), var(--cds-shimmer-text-ink) 37.5%, var(--cds-shimmer-text-peak) 50%, var(--cds-shimmer-text-ink) 62.5%); animation: 3s linear infinite cds-shimmer-text-shine;",
			strong: "background-image: linear-gradient(var(--cds-shimmer-text-angle, 120deg), var(--cds-shimmer-text-bell-stops)); animation: 3s linear infinite cds-shimmer-text-shine-strong;",
		});
	});

	it("eases the strong band and shine with upstream's cubic-bezier(.45,0,.55,1)", () => {
		const keyframes = (name: string, from: string, to: string, easing: string) =>
			includes(
				`@keyframes ${name} { 0%, 15% { animation-timing-function: ${easing}; ${from} } 85%, to { ${to} } }`,
			);
		const band = "cubic-bezier(0.714, 0.121, 0.211, 0.888)";
		const strong = "cubic-bezier(0.45, 0, 0.55, 1)";
		expect({
			bandStrong: keyframes("cds-shimmer-text-band-strong", "translate: -62.5%;", "translate: -12.5%;", strong),
			bandStrongRtl: keyframes(
				"cds-shimmer-text-band-strong-rtl",
				"translate: -12.5%;",
				"translate: -62.5%;",
				strong,
			),
			shine: keyframes(
				"cds-shimmer-text-shine",
				"background-position: 83.333% 0;",
				"background-position: 16.667% 0;",
				band,
			),
			shineRtl: keyframes(
				"cds-shimmer-text-shine-rtl",
				"background-position: 16.667% 0;",
				"background-position: 83.333% 0;",
				band,
			),
			shineStrong: keyframes(
				"cds-shimmer-text-shine-strong",
				"background-position: 83.333% 0;",
				"background-position: 16.667% 0;",
				strong,
			),
			shineStrongRtl: keyframes(
				"cds-shimmer-text-shine-strong-rtl",
				"background-position: 16.667% 0;",
				"background-position: 83.333% 0;",
				strong,
			),
		}).toStrictEqual({
			bandStrong: true,
			bandStrongRtl: true,
			shine: true,
			shineRtl: true,
			shineStrong: true,
			shineStrongRtl: true,
		});
	});

	it("paints a strong label's clone in primary ink while motion is on", () => {
		expect(
			includes(
				'@media screen and (prefers-reduced-motion: no-preference) and (forced-colors: none) { [data-cds-shimmer-copy-inks]:not([data-reduce-motion="true"] *) { -webkit-text-fill-color: transparent; } [data-cds-shimmer-copy-inks]:not([data-reduce-motion="true"] *) > [inert] { background-color: var(--upstream-text-primary, currentcolor); } }',
			),
		).toBe(true);
	});
});

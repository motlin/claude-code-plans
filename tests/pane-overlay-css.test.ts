import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {ruleDeclarations} from "./markdown-css";

const css = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

const GLIDE = "translate var(--tile-overlay-duration) var(--tile-overlay-ease)";

describe("upstream pane overlay CSS (shared-41 oU/iT/FG, shared-18 Z8, ca67f2c9d tiles overlay)", () =>
{
	it.each([
		[
			"the chat columns glide by half the reserve",
			"[data-pane-overlay] :is(.chat-column, .chat-dock-column)",
			{
				translate: "var(--epitaxy-overlay-column-shift, none)",
				transition: GLIDE,
			},
		],
		[
			"a column nested in a shifted one is not shifted twice",
			":is(.chat-column, .chat-dock-column) > *",
			{
				"--epitaxy-overlay-column-shift": "none",
			},
		],
		[
			"the docked rail glides by the whole reserve",
			"[data-pane-overlay] [data-epitaxy-rail-column]",
			{
				translate: "var(--epitaxy-overlay-rail-titlebar-shift, none)",
				transition: GLIDE,
			},
		],
		[
			"a rail-docked chat's titlebar takes the rail's shift",
			"[data-pane-overlay] [data-session-rail-docked]",
			{
				"--epitaxy-overlay-titlebar-shift": "var(--epitaxy-overlay-rail-titlebar-shift)",
			},
		],
		[
			"the columns mirror in RTL",
			':root[dir="rtl"] [data-pane-overlay] :is(.chat-column, .chat-dock-column):dir(rtl)',
			{
				translate: "calc(-1 * var(--epitaxy-overlay-column-shift))",
			},
		],
		[
			"the rail mirrors in RTL",
			':root[dir="rtl"] [data-pane-overlay] [data-epitaxy-rail-column]:dir(rtl)',
			{
				translate: "calc(-1 * var(--epitaxy-overlay-rail-titlebar-shift))",
			},
		],
		[
			"every tile shell carries the overlay timing",
			".tiles-shell",
			{
				"--tile-overlay-duration": "0.2s",
				"--tile-overlay-ease": "var(--cds-ease-out, ease-out)",
			},
		],
		[
			"the overlay shell slides in from the reserve",
			".tiles-overlay-shell",
			{
				animation: "tiles-overlay-enter var(--tile-overlay-duration) var(--tile-overlay-ease)",
			},
		],
		[
			"the chat under it is clipped once the slide ends",
			".tiles-under-overlay",
			{
				"clip-path": "inset(0 var(--tile-overlay-reserve) calc(-1 * (var(--tiles-padding, 0px) + 1px)) 0)",
				animation: "tiles-overlay-clip var(--tile-overlay-duration) step-end",
			},
		],
		[
			"the slide mirrors in RTL",
			':root[dir="rtl"] .tiles-overlay-shell:dir(rtl)',
			{
				"animation-name": "tiles-overlay-enter-rtl",
			},
		],
		[
			"the clip mirrors in RTL",
			':root[dir="rtl"] .tiles-under-overlay:dir(rtl)',
			{
				"clip-path": "inset(0 0 calc(-1 * (var(--tiles-padding, 0px) + 1px)) var(--tile-overlay-reserve))",
			},
		],
	])("%s", (_label, selector, declarations) =>
	{
		expect(ruleDeclarations(css, selector)).toStrictEqual(declarations);
	});

	it("ports the keyframes and the reduced-motion block", () =>
	{
		const keyframes = [
			"@keyframes tiles-overlay-enter",
			"@keyframes tiles-overlay-clip",
			"@keyframes tiles-overlay-enter-rtl",
		].map((name) => css.slice(css.indexOf(name), css.indexOf("}", css.indexOf("}", css.indexOf(name)) + 1) + 1));
		const reduced = css.slice(css.indexOf("/* Upstream ca67f2c9d: no overlay motion */"));

		expect(
			{
				keyframes: keyframes.map((block) => block.replace(/\s+/g, " ")),
				shell: ruleDeclarations(reduced, ".tiles-shell"),
				animations: ruleDeclarations(
					reduced,
					'.tiles-overlay-shell,\n\t.tiles-under-overlay,\n\t:root[dir="rtl"] .tiles-overlay-shell:dir(rtl)',
				),
			},
		).toStrictEqual(
			{
				keyframes: [
					"@keyframes tiles-overlay-enter { 0% { translate: var(--tile-overlay-reserve) 0; } }",
					"@keyframes tiles-overlay-clip { 0% { clip-path: none; } }",
					"@keyframes tiles-overlay-enter-rtl { 0% { translate: calc(-1 * var(--tile-overlay-reserve)) 0; } }",
				],
				shell:
				{
					"--tile-overlay-duration": "0s",
				},
				animations:
				{
					animation: "none",
				},
			},
		);
	});
});

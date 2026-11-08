// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import {DIFF_RAILS_CSS, adoptDiffSheet, adoptRails, markRailRuns} from "../src/components/changes/diff-rails";

describe("DIFF_RAILS_CSS", () => {
	it("is upstream ca9e46d28 q, built from the same parts", () => {
		const N = ":is([data-line],[data-no-newline])";
		const P = `[data-indicators="classic"] ${N}`;
		const F = ':is([data-column-number],[data-gutter-buffer="metadata"])';
		const I = '[data-line-type="change-addition"]';
		const L = '[data-line-type="change-deletion"]';
		const R = `:is(${I},${L})`;
		const z = "@media (forced-colors:active),(prefers-contrast:more)";
		const U = "6px";
		const W = `${U} + 2px`;
		const G = ":host([data-add-button]) [data-diff]:not([data-disable-line-numbers])";
		const H =
			":host{--diff-rail-added:light-dark(color-mix(in lab,var(--diffs-addition-base) 86%,black),color-mix(in lab,var(--diffs-addition-base) 80%,var(--diffs-bg)));--diff-rail-removed:light-dark(color-mix(in lab,var(--diffs-deletion-base) 90%,black),color-mix(in lab,var(--diffs-deletion-base) 76%,white))}";
		const box = `content:"";position:absolute;left:0;width:${U};top:0;bottom:0;pointer-events:none`;
		const additions = "background:var(--diff-rail-added)";
		const deletions =
			"background:linear-gradient(135deg,var(--diff-rail-removed) 25%,transparent 25% 50%,var(--diff-rail-removed) 50% 75%,transparent 75%) 0 0/calc(var(--diffs-line-height,20px) / 4) calc(var(--diffs-line-height,20px) / 4)";
		const forcedColors = "forced-color-adjust:none;--diff-rail-added:CanvasText;--diff-rail-removed:CanvasText";
		const expected = `@supports (content:"x" / "y") and (color:light-dark(red,red)) and (color:color-mix(in lab,red,red)){${[
			H,
			`${P}{padding-inline-start:1ch}`,
			`${P}${R}::before{opacity:0}`,
			`${P}${I}::before{content:"+" / var(--diff-word-added,"added")}`,
			`${P}${L}::before{content:"−" / var(--diff-word-removed,"removed")}`,
			`${z}{${P}{padding-inline-start:2ch}${P}${R}::before{opacity:1}}`,
			`:host ${F}${R}{box-shadow:none}`,
			`${F}${R}::after{${box}}`,
			`[data-diff][data-disable-line-numbers] ${F}{min-width:calc(${U} + 3px)}`,
			`${F}${I}::after{${additions}}`,
			`${F}${L}::after{${deletions}}`,
			`${F}[data-rail-start]::after{border-top-left-radius:1px;border-top-right-radius:1px}`,
			`${F}[data-rail-end]::after{border-bottom-left-radius:1px;border-bottom-right-radius:1px}`,
			`@media (forced-colors:active){${F}${R}::after{${forcedColors}}}`,
			"[data-gutter-utility-slot]{z-index:2}",
			`${G} [data-gutter-utility-slot]{left:calc(${W} + 0.125rem)}`,
			`${G} [data-column-number]{padding-left:max(2ch + 5px,${W} + 1rem + 1px)}`,
			`${F}${I}{--mix-light:88%;--mix-dark:80%}`,
			`:is(${F},${N})${L}{--mix-light:91.5%;--mix-dark:90%}`,
		].join("")}}`;
		expect(DIFF_RAILS_CSS).toStrictEqual(expected);
		for (const part of [
			'content:"−" / var(--diff-word-removed,"removed")',
			"left:calc(6px + 2px + 0.125rem)",
			"padding-left:max(2ch + 5px,6px + 2px + 1rem + 1px)",
			"min-width:calc(6px + 3px)",
			"calc(var(--diffs-line-height,20px) / 4)",
		]) {
			expect(DIFF_RAILS_CSS).toContain(part);
		}
	});

	it("keeps the forced-colors / prefers-contrast fallback", () => {
		expect(DIFF_RAILS_CSS).toContain(
			'@media (forced-colors:active),(prefers-contrast:more){[data-indicators="classic"] :is([data-line],[data-no-newline]){padding-inline-start:2ch}',
		);
		expect(DIFF_RAILS_CSS).toContain(
			"forced-color-adjust:none;--diff-rail-added:CanvasText;--diff-rail-removed:CanvasText",
		);
	});
});

function shadowHost(): {host: HTMLElement; root: ShadowRoot} {
	const host = document.createElement("div");
	const root = host.attachShadow({mode: "open"});
	// Browsers start every shadow root with an empty list; jsdom leaves it undefined until assigned (pierre assigns it).
	root.adoptedStyleSheets = [];
	return {host, root};
}

describe("adoptDiffSheet", () => {
	it("appends one sheet per window, once per shadow root", () => {
		const base = new CSSStyleSheet();
		const a = shadowHost();
		a.root.adoptedStyleSheets = [base];
		adoptRails(a.host);
		adoptRails(a.host);
		const b = shadowHost();
		adoptRails(b.host);
		expect({
			length: a.root.adoptedStyleSheets.length,
			baseKept: a.root.adoptedStyleSheets[0] === base,
			shared: a.root.adoptedStyleSheets[1] === b.root.adoptedStyleSheets[0],
			bLength: b.root.adoptedStyleSheets.length,
		}).toStrictEqual({length: 2, baseKept: true, shared: true, bLength: 1});
	});

	it("fills the sheet with its css", () => {
		const adopt = adoptDiffSheet(":host{color:red}");
		const {host, root} = shadowHost();
		adopt(host);
		const sheet = root.adoptedStyleSheets[0];
		if (sheet === undefined) throw new Error("no sheet adopted");
		expect([...sheet.cssRules].map((rule) => rule.cssText)).toStrictEqual([":host { color: red; }"]);
	});

	it("is a no-op for a host with no shadow root", () => {
		expect(() => {
			adoptRails(document.createElement("div"));
		}).not.toThrow();
	});

	it("setDisabled flips every sheet it made", () => {
		const adopt = adoptDiffSheet(":host{color:red}");
		const {host, root} = shadowHost();
		adopt(host);
		adopt.setDisabled(true);
		const disabledAfterFlip = root.adoptedStyleSheets[0]?.disabled;
		const other = shadowHost();
		adopt(other.host);
		expect({disabledAfterFlip, newSheet: other.root.adoptedStyleSheets[0]?.disabled}).toStrictEqual({
			disabledAfterFlip: true,
			newSheet: true,
		});
	});
});

describe("markRailRuns", () => {
	function gutterHost(types: string[]): {host: HTMLElement; rows: HTMLElement[]; split: HTMLElement[]} {
		const {host, root} = shadowHost();
		const build = (): HTMLElement[] => {
			const gutter = document.createElement("div");
			gutter.setAttribute("data-gutter", "");
			const rows = types.map((type) => {
				const row = document.createElement("div");
				row.setAttribute("data-line-type", type);
				gutter.append(row);
				return row;
			});
			root.append(gutter);
			return rows;
		};
		return {host, rows: build(), split: build()};
	}
	const marks = (rows: HTMLElement[]): boolean[][] =>
		rows.map((row) => [row.hasAttribute("data-rail-start"), row.hasAttribute("data-rail-end")]);

	it("marks the first and last row of each change run, in every gutter", () => {
		const {host, rows, split} = gutterHost([
			"context",
			"change-deletion",
			"change-addition",
			"context",
			"change-addition",
			"context",
		]);
		markRailRuns(host);
		const expected = [
			[false, false],
			[true, false],
			[false, true],
			[false, false],
			[true, true],
			[false, false],
		];
		expect({rows: marks(rows), split: marks(split)}).toStrictEqual({rows: expected, split: expected});
	});

	it("re-marks after rows change, dropping stale attributes", () => {
		const {host, rows} = gutterHost([
			"context",
			"change-deletion",
			"change-addition",
			"context",
			"change-addition",
			"context",
		]);
		markRailRuns(host);
		rows[3]?.setAttribute("data-line-type", "change-addition");
		markRailRuns(host);
		expect(marks(rows)).toStrictEqual([
			[false, false],
			[true, false],
			[false, false],
			[false, false],
			[false, true],
			[false, false],
		]);
	});

	it("is a no-op for a host with no shadow root", () => {
		expect(() => {
			markRailRuns(document.createElement("div"));
		}).not.toThrow();
	});
});

// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {DiffFile} from "../src/components/changes/diff-file";
import {CA, EA, SA, TA, WA} from "../src/components/changes/diffs-config";
import {DIFF_RAILS_CSS} from "../src/components/changes/diff-rails";
import {PanelsOff} from "./fizzy-lake-off";
import {DEFAULTS, SettingsContext} from "../src/components/settings-context";
import {preloadFileTypeIcons} from "../src/components/file-type-icons-loader";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
+export const loud = (name: string) => greet(name).toUpperCase();
`;

function shadowRootOf(container: HTMLElement): ShadowRoot {
	const host = container.querySelector("diffs-container");
	if (!host?.shadowRoot) throw new Error("diffs-container has no shadow root yet");
	return host.shadowRoot;
}

/** The cds FileDiff wrapper div that carries upstream's host style (ca7ba268c Va). */
function hostOf(container: HTMLElement): HTMLElement | null {
	const parent = container.querySelector("diffs-container")?.parentElement;
	return parent instanceof HTMLElement && parent.getAttribute("data-cds") === "FileDiff" ? parent : null;
}

/** The injected `@layer unsafe` text inside the diff's shadow root. */
function unsafeLayer(container: HTMLElement): string {
	const text = [...shadowRootOf(container).querySelectorAll("style")].map((style) => style.textContent).join("");
	const start = text.indexOf("@layer unsafe");
	return start === -1 ? "" : text.slice(start);
}

/** Whether the rails sheet (upstream ca9e46d28 `q`) is among the shadow root's adopted sheets. */
function hasRailsSheet(root: ShadowRoot): boolean {
	return root.adoptedStyleSheets.some((sheet) =>
		[...sheet.cssRules].some((rule) => rule.cssText.includes("--diff-rail-added")),
	);
}

/** Each gutter row as `type[:start][:end]`, from the run marks `markRailRuns` sets. */
function gutterRailMarks(root: ShadowRoot): string[] {
	return [...root.querySelectorAll("[data-gutter] > [data-line-type]")].map((row) =>
		[
			row.getAttribute("data-line-type"),
			row.hasAttribute("data-rail-start") ? "start" : "",
			row.hasAttribute("data-rail-end") ? "end" : "",
		]
			.filter(Boolean)
			.join(":"),
	);
}

const PATCH_RAIL_MARKS = [
	"context",
	"change-addition:start",
	"change-deletion",
	"change-addition:end",
	"context",
	"change-addition:start:end",
];

/** Two hunks with function context; the second starts with a deletion (matched by deletionStart). */
const HEADED_PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -14,3 +14,3 @@ function foo() {
   a
-  b
+  B
   c
@@ -24,3 +24,3 @@ function second() {
-  b
+  B
   c
   d
`;

/** A session-edits style hunk: bare header, no context. */
const BARE_PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -14,3 +14,3 @@
   a
-  b
+  B
   c
`;

function hunkHeadingState(root: ShadowRoot) {
	return {
		labels: [...root.querySelectorAll("[data-gutter] [data-unmodified-lines]")]
			.filter((label) => label.querySelector("[data-hunk-heading]"))
			.map((label) => ({
				count: label.querySelector("[data-unmodified-count]")?.textContent,
				heading: label.querySelector("[data-hunk-heading]")?.textContent,
				title: label.querySelector("[data-hunk-heading]")?.getAttribute("title"),
			})),
		sheet: root.adoptedStyleSheets.some((sheet) =>
			[...sheet.cssRules].some((rule) => rule.cssText.includes("[data-hunk-heading]")),
		),
		outsideDeletions: root.querySelectorAll("[data-additions] [data-hunk-heading]").length,
	};
}

function contentRowTypes(root: ShadowRoot): string[] {
	return [...root.querySelectorAll("[data-content] > [data-line-type]")].map(
		(row) => row.getAttribute("data-line-type") ?? "",
	);
}

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeAll(async () => {
	await preloadFileTypeIcons();
});

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Settings context values with only Code font size changed. */
function settingsWithCodeFontSize(codeFontSize: 20 | null) {
	return {
		settings: {...DEFAULTS, codeFontSize},
		loaded: true,
		setSetting: () => undefined,
		setVerbosity: () => undefined,
		resetAll: () => undefined,
	};
}
const CODE_FONT_SIZE_CONTEXT = {default: settingsWithCodeFontSize(null), twenty: settingsWithCodeFontSize(20)};

function withCodeFontSize(codeFontSize: 20 | null) {
	return (
		<SettingsContext.Provider
			value={codeFontSize === null ? CODE_FONT_SIZE_CONTEXT.default : CODE_FONT_SIZE_CONTEXT.twenty}
		>
			<DiffFile patch={PATCH} />
		</SettingsContext.Provider>
	);
}

describe("DiffFile", () => {
	// Upstream c44d00c7f passes c82eca2bd c()'s ×1.5 lineHeight, so za() writes it on the host; a size also sets the font.
	it("sizes Changes rows from Settings ▸ Code font size at ×1.5 on the host, and remounts when the metric changes", async () => {
		const hostVars = (container: HTMLElement) => {
			const host = hostOf(container);
			return {
				leading: host?.style.getPropertyValue("--diffs-line-height"),
				size: host?.style.getPropertyValue("--diffs-font-size"),
			};
		};
		const view = render(withCodeFontSize(null));
		await waitFor(() => {
			expect(hostVars(view.container)).toStrictEqual({leading: "20px", size: "var(--upstream-text-code)"});
		});
		const previousHost = view.container.querySelector("diffs-container");

		view.rerender(withCodeFontSize(20));
		await waitFor(() => {
			expect(hostVars(view.container)).toStrictEqual({leading: "30px", size: "1.25rem"});
		});
		expect(view.container.querySelector("diffs-container")).not.toBe(previousHost);
	});

	it("renders every added, removed and context row of a patch, pairing the rewritten line with its replacement", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			expect(contentRowTypes(shadowRootOf(container))).toEqual([
				"context",
				"change-addition",
				"change-deletion",
				"change-addition",
				"context",
				"change-addition",
			]);
		});
	});

	it("applies the upstream Changes pane options to the rendered <pre>", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const pre = shadowRootOf(container).querySelector("pre[data-diff]");
			expect({
				indicators: pre?.getAttribute("data-indicators"),
				diffType: pre?.getAttribute("data-diff-type"),
				overflow: pre?.getAttribute("data-overflow"),
			}).toEqual({indicators: "classic", diffType: "single", overflow: "wrap"});
		});
	});

	it("sets upstream's wrap-only overflow vars on the host only when word wrap is on, so scroll mode can scroll", async () => {
		const overflowVars = (container: HTMLElement) => {
			const host = hostOf(container);
			return {
				overflow: host?.style.getPropertyValue("--diffs-overflow-override"),
				gutter: host?.style.getPropertyValue("--diffs-scrollbar-gutter-override"),
			};
		};
		const wrapped = render(<DiffFile patch={PATCH} />);
		await waitFor(() => {
			expect(overflowVars(wrapped.container)).toStrictEqual({overflow: "clip", gutter: "0px"});
		});
		cleanup();

		const scrolled = render(<DiffFile patch={PATCH} wordWrap={false} />);
		await waitFor(() => {
			expect(overflowVars(scrolled.container)).toStrictEqual({overflow: "", gutter: ""});
		});
	});

	it("injects upstream's za() list into the shadow root's unsafe layer, Ta only while panels is on and Ca only with the gutter +", async () => {
		const panels = render(<DiffFile patch={PATCH} />);
		await waitFor(() => {
			expect(contentRowTypes(shadowRootOf(panels.container))).toHaveLength(6);
		});
		const on = unsafeLayer(panels.container);
		expect({
			wa: on.includes(WA + TA + EA),
			sa: on.includes(SA),
			ca: on.includes(CA),
		}).toStrictEqual({wa: true, sa: false, ca: false});
		cleanup();

		const off = render(
			<PanelsOff>
				<DiffFile patch={PATCH} onRequestChanges={() => undefined} />
			</PanelsOff>,
		);
		await waitFor(() => {
			expect(contentRowTypes(shadowRootOf(off.container))).toHaveLength(6);
		});
		const gutter = unsafeLayer(off.container);
		expect({
			ca: gutter.includes(CA + WA + EA),
			ta: gutter.includes(TA),
		}).toStrictEqual({ca: true, ta: false});
	});

	it("wraps pierre in upstream's cds FileDiff div carrying the host style and the code theme background", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);
		await waitFor(() => {
			const host = hostOf(container);
			expect({
				dir: host?.getAttribute("dir"),
				className: host?.getAttribute("class"),
				gap: host?.style.getPropertyValue("--diffs-gap-style"),
				bg: host?.style.getPropertyValue("--cds-filediff-bg"),
				pierreStyle: container.querySelector("diffs-container")?.getAttribute("style") ?? null,
			}).toStrictEqual({
				dir: "ltr",
				className: "text-code text-primary font-normal",
				gap: "0",
				bg: "light-dark(#faf9f580, #191919)",
				pierreStyle: null,
			});
		});
	});

	it("renders side-by-side when diffStyle is split", async () => {
		const {container} = render(<DiffFile patch={PATCH} diffStyle="split" />);

		await waitFor(() => {
			const pre = shadowRootOf(container).querySelector("pre[data-diff]");
			expect(pre?.getAttribute("data-diff-type")).toBe("split");
		});
	});

	it("slots the custom header with the file name and +/- counts instead of the library header", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const header = container.querySelector("[data-diff-file-header]");
			expect({
				path: header?.getAttribute("data-diff-file-header"),
				slot: header?.parentElement?.getAttribute("slot"),
				text: header?.textContent,
			}).toEqual({path: "src/greet.ts", slot: "header-custom", text: "greet.tssrc+3−1"});
		});
	});

	it("draws upstream's 12px file-type icon for the header's file before the path", async () => {
		const {container} = render(
			<FileTypeIconSetContext value="pierre">
				<DiffFile patch={PATCH} />
			</FileTypeIconSetContext>,
		);

		await waitFor(() => {
			const header = container.querySelector("[data-diff-file-header]");
			const icon = header?.querySelector<SVGSVGElement>("svg[data-file-type-icon]");
			expect({
				className: icon?.getAttribute("class"),
				width: icon?.style.width,
				height: icon?.style.height,
				fills: [...(icon?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("fill")),
				nextClass: icon?.nextElementSibling?.getAttribute("class"),
				lucide: header?.querySelectorAll(".lucide-file-text").length,
			}).toEqual({
				className: "shrink-0 text-ink-muted",
				width: "12px",
				height: "12px",
				fills: ["var(--fti-typescript)", "var(--fti-typescript)"],
				nextClass: "flex min-w-0 text-body text-secondary",
				lucide: 0,
			});
		});
	});

	it("mounts the custom header slot inside the shadow root so the header is visible", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const header = shadowRootOf(container).querySelector("[data-diffs-header]");
			expect({
				mode: header?.getAttribute("data-diffs-header"),
				changeType: header?.getAttribute("data-change-type"),
				slot: header?.querySelector("slot")?.getAttribute("name"),
			}).toEqual({mode: "custom", changeType: "change", slot: "header-custom"});
		});
	});

	// Upstream ca9e46d28 Q(wordDiff, !readOnly).draw from each onPostRender (Changes pane c44d00c7f `se.draw(e)`).
	it("adopts upstream's rails sheet and marks change runs after every render, with data-add-button only when commenting", async () => {
		const view = render(<DiffFile patch={PATCH} />);
		const state = () => {
			const host = view.container.querySelector("diffs-container");
			const root = shadowRootOf(view.container);
			return {
				rails: hasRailsSheet(root),
				marks: gutterRailMarks(root),
				addButton: host?.hasAttribute("data-add-button"),
				words: [
					hostOf(view.container)?.style.getPropertyValue("--diff-word-added"),
					hostOf(view.container)?.style.getPropertyValue("--diff-word-removed"),
				],
			};
		};
		const expected = {
			rails: true,
			marks: PATCH_RAIL_MARKS,
			addButton: false,
			words: ['"added"', '"removed"'],
		};
		await waitFor(() => {
			expect(state()).toStrictEqual(expected);
		});

		view.rerender(<DiffFile patch={PATCH} wordWrap={false} />);
		await waitFor(() => {
			expect(shadowRootOf(view.container).querySelector("pre[data-diff]")?.getAttribute("data-overflow")).toBe(
				"scroll",
			);
		});
		expect(state()).toStrictEqual(expected);

		view.rerender(<DiffFile patch={PATCH} onRequestChanges={() => undefined} />);
		await waitFor(() => {
			expect(state()).toStrictEqual({...expected, addButton: true});
		});
	});

	// Upstream c44d00c7f xn: Bn(e, fileDiff) (c91a5e4a6 g) after the other post-render passes.
	it("heads each gutter separator with its hunk's context and adopts the hunk-heading sheet", async () => {
		const view = render(<DiffFile patch={HEADED_PATCH} />);
		const expected = {
			labels: [
				{count: "13 unmodified lines", heading: "function foo() {", title: "function foo() {"},
				{count: "7 unmodified lines", heading: "function second() {", title: "function second() {"},
			],
			sheet: true,
			outsideDeletions: 0,
		};
		await waitFor(() => {
			expect(hunkHeadingState(shadowRootOf(view.container))).toStrictEqual(expected);
		});

		view.rerender(<DiffFile patch={HEADED_PATCH} wordWrap={false} />);
		await waitFor(() => {
			expect(shadowRootOf(view.container).querySelector("pre[data-diff]")?.getAttribute("data-overflow")).toBe(
				"scroll",
			);
		});
		expect(hunkHeadingState(shadowRootOf(view.container))).toStrictEqual(expected);
	});

	it("puts split-view headings in the deletions column only", async () => {
		const view = render(<DiffFile patch={HEADED_PATCH} diffStyle="split" />);
		await waitFor(() => {
			const root = shadowRootOf(view.container);
			expect({
				deletions: root.querySelectorAll("[data-deletions] [data-hunk-heading]").length,
				all: root.querySelectorAll("[data-hunk-heading]").length,
			}).toStrictEqual({deletions: 2, all: 2});
		});
	});

	it("gives a context-less session-edits hunk no heading", async () => {
		const view = render(<DiffFile patch={BARE_PATCH} />);
		await waitFor(() => {
			expect(shadowRootOf(view.container).querySelector("[data-gutter] [data-unmodified-lines]")?.innerHTML).toBe(
				"13 unmodified lines",
			);
		});
		expect(shadowRootOf(view.container).querySelectorAll("[data-hunk-heading]").length).toBe(0);
	});

	it("moves the gutter + clear of the rail under data-add-button", () => {
		expect(DIFF_RAILS_CSS).toContain(
			":host([data-add-button]) [data-diff]:not([data-disable-line-numbers]) [data-gutter-utility-slot]{left:calc(6px + 2px + 0.125rem)}",
		);
	});
});

// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {DiffFile} from "../src/components/changes/diff-file";
import {DIFFS_STYLE_OVERRIDES, diffsUnsafeCss} from "../src/components/changes/diffs-config";
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
			const host = container.querySelector<HTMLElement>("diffs-container");
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
			const host = container.querySelector<HTMLElement>("diffs-container");
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

	it("injects upstream's panels hunk-separator CSS (ca7ba268c za() Ta) only while panels is on, with the comfortable pad-md on the host", async () => {
		const TA =
			"[data-separator-wrapper]{padding-left:var(--cds-pad-md)}@media (pointer:fine){[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px calc(24px - var(--cds-pad-md)) auto}}";
		const injected = (container: HTMLElement) =>
			[...shadowRootOf(container).querySelectorAll("style")].some((style) => style.textContent.includes(TA));
		expect({
			on: diffsUnsafeCss({panels: true}),
			off: diffsUnsafeCss({panels: false}),
			padMd: (DIFFS_STYLE_OVERRIDES as Record<string, string>)["--cds-pad-md"],
		}).toStrictEqual({on: TA, off: "", padMd: "8px"});

		const panels = render(<DiffFile patch={PATCH} />);
		await waitFor(() => {
			expect(injected(panels.container)).toBe(true);
		});
		cleanup();

		const off = render(
			<PanelsOff>
				<DiffFile patch={PATCH} />
			</PanelsOff>,
		);
		await waitFor(() => {
			expect(contentRowTypes(shadowRootOf(off.container))).toHaveLength(6);
		});
		expect(injected(off.container)).toBe(false);
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
});
